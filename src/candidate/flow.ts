import type { Request, Response } from "express";
import { createCandidateRepoZip } from "./artifactZip.js";
import { CoderClient } from "./coderClient.js";
import {
  candidateSessionStore,
  type CandidateSessionRecord,
  type CandidateSessionStore,
} from "./store.js";
import { createSecretToken, hashToken, tokenMatches } from "./tokens.js";

export type CandidateLaunchResult = {
  candidateLaunchUrl: string;
};

export type CandidateCoder = Pick<
  CoderClient,
  "createUser" | "createWorkspace" | "updateUserPassword" | "workspaceUrl"
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
    res.send(
      renderLaunchPage({
        title: "Assessment workspace",
        record,
        workspaceUrl: coder.workspaceUrl(record.coderUsername, record.coderWorkspaceName),
        launchToken,
      }),
    );
    return;
  }

  const coder = options.coder ?? new CoderClient();
  const coderUsername = store.makeCoderUsername(record.sessionId);
  const coderWorkspaceName = store.makeWorkspaceName(record.sessionId);
  const coderPassword = createSecretToken(18);
  const artifactToken = createSecretToken(32);

  try {
    const user = await coder.createUser({
      username: coderUsername,
      password: coderPassword,
      email: `${coderUsername}@bugfarm.local`,
      name: `Candidate ${coderUsername}`,
    });
    const workspace = await coder.createWorkspace({
      username: coderUsername,
      workspaceName: coderWorkspaceName,
      artifactHash: record.artifactHash,
      sessionId: record.sessionId,
      artifactToken,
    });

    await store.markProvisioned({
      sessionId: record.sessionId,
      artifactTokenHash: hashToken(artifactToken),
      coderUserId: user.id,
      coderUsername: user.username,
      coderWorkspaceId: workspace.id,
      coderWorkspaceName: workspace.name,
    });

    res.send(
      renderLaunchPage({
        title: "Assessment workspace created",
        record: {
          ...record,
          status: "provisioned",
          coderUserId: user.id,
          coderUsername: user.username,
          coderWorkspaceId: workspace.id,
          coderWorkspaceName: workspace.name,
        },
        workspaceUrl: coder.workspaceUrl(user.username, workspace.name),
        coderPassword,
        launchToken,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Coder provisioning error";
    await store.markFailed(record.sessionId, message);
    res.status(500).send(renderMessagePage("Workspace provisioning failed", message));
  }
}

export async function handleCandidatePasswordReset(
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

  if (!record || isExpired(record)) {
    res.status(404).send(renderMessagePage("Invalid assessment link", "This assessment link is invalid or expired."));
    return;
  }

  if (!record.coderUsername || !record.coderWorkspaceName) {
    res.status(400).send(renderMessagePage("Workspace not ready", "Open the launch link first to create the workspace."));
    return;
  }

  const coder = options.coder ?? new CoderClient();
  const coderPassword = createSecretToken(18);

  try {
    await coder.updateUserPassword({
      username: record.coderUsername,
      password: coderPassword,
    });
    await store.resetCoderPassword({ sessionId: record.sessionId });
    res.send(
      renderLaunchPage({
        title: "Coder password reset",
        record,
        workspaceUrl: coder.workspaceUrl(record.coderUsername, record.coderWorkspaceName),
        coderPassword,
        launchToken,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Coder password reset error";
    res.status(500).send(renderMessagePage("Password reset failed", message));
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

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isExpired(record: CandidateSessionRecord): boolean {
  return Date.parse(record.expiresAt) <= Date.now();
}

function renderLaunchPage(input: {
  title: string;
  record: CandidateSessionRecord;
  workspaceUrl: string;
  coderPassword?: string;
  launchToken: string;
}): string {
  const username = input.record.coderUsername || "";

  return renderPage(
    input.title,
    `
      <main>
        <h1>${escapeHtml(input.title)}</h1>
        <p>Your Coder workspace is ready.</p>
        <dl>
          <dt>Username</dt>
          <dd><code>${escapeHtml(username)}</code></dd>
          ${
            input.coderPassword
              ? `<dt>Password</dt><dd><code>${escapeHtml(input.coderPassword)}</code></dd>`
              : `<dt>Password</dt><dd>Use the password you were shown earlier, or reset it below.</dd>`
          }
        </dl>
        <p><a class="button" href="${escapeHtml(input.workspaceUrl)}">Open Coder Workspace</a></p>
        <form method="post" action="/candidate/launch/${escapeHtml(input.launchToken)}/reset-password">
          <button class="secondary" type="submit">Reset Coder Password</button>
          <p class="note">Use this only if the displayed password was lost or has expired.</p>
        </form>
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
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 12px; margin: 24px 0; }
    dt { color: #9ca3af; }
    dd { margin: 0; }
    code { background: #1f2937; border: 1px solid #374151; border-radius: 6px; padding: 4px 8px; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 10px 14px; border-radius: 6px; text-decoration: none; }
    button.secondary { background: #1f2937; color: #f9fafb; border: 1px solid #374151; border-radius: 6px; padding: 10px 14px; }
    .note { font-size: 14px; color: #9ca3af; }
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
