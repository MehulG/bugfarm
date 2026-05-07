import type { Request, Response } from "express";
import { createCandidateRepoZip } from "./artifactZip.js";
import { CoderClient } from "./coderClient.js";
import {
  candidateSessionStore,
  type CandidateSessionRecord,
  type CandidateSessionStore,
} from "./store.js";
import { createSecretToken, hashToken, tokenMatches } from "./tokens.js";
import type { CandidateEvaluationResult } from "../assessment/types.js";

export type CandidateLaunchResult = {
  candidateLaunchUrl: string;
};

export type CandidateCoder = Pick<
  CoderClient,
  | "createUser"
  | "createWorkspace"
  | "workspaceUrl"
  | "codeServerUrl"
  | "getWorkspaceReadiness"
  | "stopWorkspace"
>;

export async function createCandidateLaunchForAssessment(input: {
  assessmentId: string;
  artifactPath: string;
  store?: CandidateSessionStore;
}): Promise<CandidateLaunchResult> {
  const created = await (input.store ?? candidateSessionStore).createPendingSession({
    assessmentId: input.assessmentId,
    artifactPath: input.artifactPath,
  });

  return {
    candidateLaunchUrl: created.candidateLaunchUrl,
  };
}

export async function handleCandidateLaunch(
  req: Request,
  res: Response,
  options: {
    store?: CandidateSessionStore;
    coder?: CandidateCoder;
  } = {},
): Promise<void> {
  const store = options.store ?? candidateSessionStore;
  const launchToken = req.params.launchToken;
  const record = await store.findByLaunchToken(launchToken);

  if (!record) {
    res.status(404).send(renderMessagePage("Invalid assessment link", "This assessment link was not found."));
    return;
  }

  if (isExpired(record)) {
    res.status(410).send(renderMessagePage("Expired assessment link", "This assessment link has expired."));
    return;
  }

  if (record.status === "provisioned" && record.coderUsername && record.coderWorkspaceName) {
    const coder = options.coder ?? new CoderClient();
    const readiness = await coder.getWorkspaceReadiness(record.coderWorkspaceId!);
    const submission = await store.findSubmissionBySessionId(record.sessionId);
    if (readiness.status === "ready") {
      res.send(
        renderWorkspaceControlPage({
          launchToken,
          codeServerUrl: coder.codeServerUrl(record.coderUsername, record.coderWorkspaceName),
          submission,
        }),
      );
      return;
    }
    res.send(renderLaunchLoaderPage({ launchToken }));
    return;
  }

  res.send(renderLaunchLoaderPage({ launchToken }));
}

export async function handleCandidateLaunchStatus(
  req: Request,
  res: Response,
  options: {
    store?: CandidateSessionStore;
    coder?: CandidateCoder;
  } = {},
): Promise<void> {
  const store = options.store ?? candidateSessionStore;
  const launchToken = req.params.launchToken;
  const record = await store.findByLaunchToken(launchToken);

  if (!record) {
    res.status(404).json({ status: "failed", message: "This assessment link was not found." });
    return;
  }

  if (isExpired(record)) {
    res.status(410).json({ status: "failed", message: "This assessment link has expired." });
    return;
  }

  const provisioned = await ensureCandidateWorkspace({
    record,
    store,
    coder: options.coder,
  });
  const readiness = await provisioned.coder.getWorkspaceReadiness(provisioned.record.coderWorkspaceId!);
  const codeServerUrl = provisioned.coder.codeServerUrl(
    provisioned.record.coderUsername!,
    provisioned.record.coderWorkspaceName!,
  );

  res.json({
    status: readiness.status,
    message: readiness.message,
    workspaceUrl: provisioned.coder.workspaceUrl(
      provisioned.record.coderUsername!,
      provisioned.record.coderWorkspaceName!,
    ),
    codeServerUrl,
  });
}

async function ensureCandidateWorkspace(input: {
  record: CandidateSessionRecord;
  store: CandidateSessionStore;
  coder?: CandidateCoder;
}): Promise<{
  record: CandidateSessionRecord;
  coder: CandidateCoder;
}> {
  if (
    input.record.status === "provisioned" &&
    input.record.coderUsername &&
    input.record.coderWorkspaceName &&
    input.record.coderWorkspaceId
  ) {
    return {
      record: input.record,
      coder: input.coder ?? new CoderClient(),
    };
  }

  const store = input.store;
  const coder = input.coder ?? new CoderClient();
  const coderUsername = store.makeCoderUsername(input.record.sessionId);
  const coderWorkspaceName = store.makeWorkspaceName(input.record.sessionId);
  const coderPassword = createSecretToken(18);
  const artifactToken = createSecretToken(32);
  const aiProxyToken = createSecretToken(32);
  const submitToken = createSecretToken(32);

  try {
    const user = await coder.createUser({
      username: coderUsername,
      password: coderPassword,
      email: `${coderUsername}@codesheep.local`,
      name: `Candidate ${coderUsername}`,
    });
    const workspace = await coder.createWorkspace({
      username: coderUsername,
      workspaceName: coderWorkspaceName,
      artifactHash: input.record.artifactHash,
      sessionId: input.record.sessionId,
      artifactToken,
      aiProxyToken,
      submitToken,
    });

    await store.markProvisioned({
      sessionId: input.record.sessionId,
      artifactTokenHash: hashToken(artifactToken),
      aiTokenHash: hashToken(aiProxyToken),
      submitTokenHash: hashToken(submitToken),
      coderUserId: user.id,
      coderUsername: user.username,
      coderWorkspaceId: workspace.id,
      coderWorkspaceName: workspace.name,
    });

    return {
      record: {
        ...input.record,
        status: "provisioned",
        artifactTokenHash: hashToken(artifactToken),
        aiTokenHash: hashToken(aiProxyToken),
        submitTokenHash: hashToken(submitToken),
        coderUserId: user.id,
        coderUsername: user.username,
        coderWorkspaceId: workspace.id,
        coderWorkspaceName: workspace.name,
      },
      coder,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Coder provisioning error";
    await store.markFailed(input.record.sessionId, message);
    throw error;
  }
}

export async function handleArtifactDownload(
  req: Request,
  res: Response,
  options: {
    store?: CandidateSessionStore;
  } = {},
): Promise<void> {
  const store = options.store ?? candidateSessionStore;
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  const artifactHash = req.params.artifactHash;
  const bearer = parseBearerToken(req.header("authorization"));

  if (!sessionId || !bearer) {
    res.status(401).json({ status: "error", message: "Artifact authorization is required" });
    return;
  }

  const record = await store.findArtifactSession({
    artifactHash,
    sessionId,
  });

  if (!record || record.status !== "provisioned" || !record.artifactTokenHash) {
    res.status(404).json({ status: "error", message: "Artifact not found" });
    return;
  }

  if (isExpired(record)) {
    res.status(403).json({ status: "error", message: "Artifact token expired" });
    return;
  }

  if (!tokenMatches(bearer, record.artifactTokenHash)) {
    res.status(403).json({ status: "error", message: "Invalid artifact token" });
    return;
  }

  try {
    const zip = await createCandidateRepoZip(record.artifactPath);
    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${record.artifactHash}.zip"`);
    res.send(zip);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build artifact zip";
    res.status(500).json({ status: "error", message });
  }
}

export async function handleCandidateLaunchSubmit(
  req: Request,
  res: Response,
  options: {
    store?: CandidateSessionStore;
    onSubmit?: (input: { record: CandidateSessionRecord; notes: string }) => Promise<CandidateEvaluationResult>;
  } = {},
): Promise<void> {
  const store = options.store ?? candidateSessionStore;
  const record = await store.findByLaunchToken(req.params.launchToken);

  if (!record) {
    res.status(404).send(renderMessagePage("Invalid assessment link", "This assessment link was not found."));
    return;
  }

  if (isExpired(record)) {
    res.status(410).send(renderMessagePage("Expired assessment link", "This assessment link has expired."));
    return;
  }

  const notes = readSubmitNotes(req);
  if (!notes) {
    res.status(400).send(renderMessagePage("Missing submission notes", "Please describe what you changed and how you verified it."));
    return;
  }

  if (!options.onSubmit) {
    throw new Error("Candidate submission handler is not configured");
  }

  await options.onSubmit({ record, notes });
  res.send(
    renderPage(
      "Submission received",
      `
        <main>
          <h1>Submission received</h1>
          <p>Your work has been submitted for evaluation. You can close this page.</p>
        </main>
      `,
    ),
  );
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function readSubmitNotes(req: Request): string {
  const bodyValue =
    (typeof req.body?.notes === "string" ? req.body.notes : "") ||
    (typeof req.body?.submitNotes === "string" ? req.body.submitNotes : "");
  return bodyValue.trim();
}

function isExpired(record: CandidateSessionRecord): boolean {
  return Date.parse(record.expiresAt) <= Date.now();
}

function renderLaunchLoaderPage(input: { launchToken: string }): string {
  const statusUrl = `/candidate/launch/${escapeHtml(input.launchToken)}/status`;

  return renderPage(
    "Starting assessment workspace",
    `
      <main>
        <div class="spinner" aria-hidden="true"></div>
        <h1>Starting assessment workspace</h1>
        <p id="status-message">Creating your Coder workspace...</p>
        <p id="manual-open" hidden><a class="button" id="code-server-link" href="#">Open code-server</a></p>
      </main>
      <script>
        const statusMessage = document.getElementById("status-message");
        const manualOpen = document.getElementById("manual-open");
        const codeServerLink = document.getElementById("code-server-link");
        let redirectScheduled = false;

        async function poll() {
          try {
            const response = await fetch("${statusUrl}", {
              headers: { "Accept": "application/json" },
            });
            const body = await response.json();

            if (!response.ok || body.status === "failed") {
              statusMessage.textContent = body.message || "Workspace provisioning failed.";
              return;
            }

            if (body.codeServerUrl) {
              codeServerLink.href = body.codeServerUrl;
              manualOpen.hidden = false;
            }

            if (body.status === "ready" && body.codeServerUrl) {
              statusMessage.textContent = "Workspace is ready. Opening code-server...";
              if (!redirectScheduled) {
                redirectScheduled = true;
                setTimeout(() => {
                  window.location.href = body.codeServerUrl;
                }, 250);
              }
              return;
            }

            statusMessage.textContent = body.message || "Workspace is starting...";
            setTimeout(poll, 3000);
          } catch (error) {
            statusMessage.textContent = "Waiting for the workspace...";
            setTimeout(poll, 3000);
          }
        }

        poll();
      </script>
    `,
  );
}

function renderWorkspaceControlPage(input: {
  launchToken: string;
  codeServerUrl: string;
  submission?: CandidateEvaluationResult;
}): string {
  const statusMessage =
    input.submission?.status === "succeeded" || input.submission?.status === "failed"
      ? "Your submission has been processed."
      : input.submission
        ? "Your submission is being evaluated."
        : "Workspace is ready. Continue in code-server and submit when you are done.";
  const submitSection = input.submission
    ? `<p>${escapeHtml(statusMessage)}</p>`
    : `
      <form method="post" action="/candidate/launch/${escapeHtml(input.launchToken)}/submit">
        <label for="submit-notes">What did you change and how did you verify it?</label>
        <textarea id="submit-notes" name="notes" required rows="6" style="width:100%;margin:12px 0;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:8px;padding:12px;"></textarea>
        <button class="button" type="submit">Submit assessment</button>
      </form>
    `;

  return renderPage(
    "Assessment workspace",
    `
      <main>
        <h1>Assessment workspace</h1>
        <p>${escapeHtml(statusMessage)}</p>
        <p><a class="button" href="${escapeHtml(input.codeServerUrl)}">Open code-server</a></p>
        <section>${submitSection}</section>
      </main>
    `,
  );
}

function renderMessagePage(title: string, message: string): string {
  return renderPage(
    title,
    `
      <main>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </main>
    `,
  );
}

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #111827; color: #f9fafb; }
    main { max-width: 720px; margin: 8vh auto; padding: 32px; }
    h1 { font-size: 28px; margin: 0 0 16px; }
    p { color: #d1d5db; line-height: 1.5; }
    section { margin: 24px 0; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 12px; margin: 24px 0; }
    dt { color: #9ca3af; }
    dd { margin: 0; }
    code { background: #1f2937; border: 1px solid #374151; border-radius: 6px; padding: 4px 8px; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 10px 14px; border-radius: 6px; text-decoration: none; }
    button.secondary { background: #1f2937; color: #f9fafb; border: 1px solid #374151; border-radius: 6px; padding: 10px 14px; }
    .note { font-size: 14px; color: #9ca3af; }
    .spinner { width: 32px; height: 32px; border: 3px solid #374151; border-top-color: #60a5fa; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
