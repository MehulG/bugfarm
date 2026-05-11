import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import { generateAssessment } from "./assessment/generateAssessment.js";
import type { GenerateAssessmentRequest } from "./assessment/types.js";
import { validateGenerateAssessmentRequest } from "./assessment/generateAssessment.js";
import type { SeedBugError } from "./codesheep/types.js";
import { jobStore } from "./jobs/store.js";
import type { JobOperation } from "./jobs/types.js";
import { openApiDocument } from "./openapi.js";
import { logger } from "./utils/logger.js";
import {
  handleArtifactDownload,
  handleCandidateLaunch,
  handleCandidateLaunchSubmit,
  handleCandidateLaunchStatus,
} from "./candidate/flow.js";
import { queueCandidateSubmission } from "./candidate/evaluation.js";
import { CandidateGitPreflightError } from "./candidate/gitSubmission.js";
import {
  attachCalculationDetails,
  attachCalculationDetailsToMany,
} from "./candidate/evaluationDetails.js";
import { candidateSessionStore } from "./candidate/store.js";
import { handleAiChatCompletions, handleAiModels } from "./ai/proxy.js";

export function createServer(): express.Express {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    "/docs",
    apiReference({
      content: openApiDocument,
      pageTitle: "Codesheep API Reference",
      theme: "default",
    }),
  );

  app.get("/candidate/launch/:launchToken", async (req, res) => {
    try {
      await handleCandidateLaunch(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown candidate launch error";
      logger.error("Failed to launch candidate workspace", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/candidate/launch/:launchToken/status", async (req, res) => {
    try {
      await handleCandidateLaunchStatus(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown candidate launch status error";
      logger.error("Failed to check candidate workspace status", { message });
      res.status(500).json({ status: "failed", message });
    }
  });

  app.post("/candidate/launch/:launchToken/submit", async (req, res) => {
    try {
      await handleCandidateLaunchSubmit(req, res, {
        onSubmit: ({ record, notes }) => queueCandidateSubmission({ record, notes }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown candidate submit error";
      if (error instanceof CandidateGitPreflightError) {
        res.status(409).send(renderPlainError(message));
        return;
      }
      logger.error("Failed to submit candidate workspace", { message });
      res.status(500).send(message);
    }
  });

  app.get("/api/artifacts/:artifactHash.zip", async (req, res) => {
    try {
      await handleArtifactDownload(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown artifact download error";
      logger.error("Failed to download candidate artifact", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.post("/api/candidate/submit", async (req, res) => {
    try {
      const token = parseBearerToken(req.header("authorization"));
      const notes =
        (typeof req.body?.notes === "string" ? req.body.notes : "") ||
        (typeof req.body?.submitNotes === "string" ? req.body.submitNotes : "");

      if (!token) {
        res.status(401).json({ status: "error", message: "Submission authorization is required" });
        return;
      }

      const record = await candidateSessionStore.findSubmitSessionByToken(token);
      if (!record || record.status !== "provisioned") {
        res.status(403).json({ status: "error", message: "Invalid submission token" });
        return;
      }

      if (Date.parse(record.expiresAt) <= Date.now()) {
        res.status(403).json({ status: "error", message: "Submission token expired" });
        return;
      }

      if (!notes.trim()) {
        res.status(400).json({ status: "error", message: "Submission notes are required" });
        return;
      }

      const submission = await queueCandidateSubmission({
        record,
        notes: notes.trim(),
      });
      res.json({
        status: submission.status,
        submissionId: submission.submissionId,
        message:
          submission.status === "queued" || submission.status === "running"
            ? "Submission accepted. Evaluation is running."
            : "Submission already exists.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown candidate submit error";
      if (error instanceof CandidateGitPreflightError) {
        res.status(409).json({ status: "error", message });
        return;
      }
      logger.error("Failed to submit candidate workspace via token", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/api/submissions", async (req, res) => {
    try {
      const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const assessmentId = typeof req.query.assessmentId === "string" ? req.query.assessmentId : undefined;
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;

      if (sessionId) {
        const submission = await candidateSessionStore.findSubmissionBySessionId(sessionId);
        res.json({
          submissions: submission
            ? [await attachCalculationDetails(submission, candidateSessionStore)]
            : [],
        });
        return;
      }

      const submissions = await candidateSessionStore.listSubmissions({ assessmentId, limit: rawLimit });
      res.json({
        submissions: await attachCalculationDetailsToMany(submissions, candidateSessionStore),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submission list error";
      logger.error("Failed to list candidate submissions", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get(
    [
      "/api/submissions/assessment/:assessmentId",
      "/api/submissions/assesment/:assessmentId",
      "/api/submission/assessment/:assessmentId",
      "/api/submission/assesment/:assessmentId",
    ],
    async (req, res) => {
      try {
        const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
        const submissions = await candidateSessionStore.listSubmissions({
          assessmentId: req.params.assessmentId,
          limit: rawLimit,
        });
        res.json({
          assessmentId: req.params.assessmentId,
          submissions: await attachCalculationDetailsToMany(submissions, candidateSessionStore),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown assessment submission lookup error";
        logger.error("Failed to fetch assessment submissions", { message });
        res.status(500).json({ status: "error", message });
      }
    },
  );

  app.get("/api/submission/:submissionId", async (req, res) => {
    try {
      const result = await candidateSessionStore.findSubmissionBySubmissionId(req.params.submissionId);
      if (!result) {
        res.status(404).json({ status: "error", message: "Submission not found" });
        return;
      }
      res.json(await attachCalculationDetails(result, candidateSessionStore));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submission lookup error";
      logger.error("Failed to fetch candidate submission", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/api/submissions/:submissionId", async (req, res) => {
    try {
      const result = await candidateSessionStore.findSubmissionBySubmissionId(req.params.submissionId);
      if (!result) {
        res.status(404).json({ status: "error", message: "Submission not found" });
        return;
      }
      res.json(await attachCalculationDetails(result, candidateSessionStore));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submission lookup error";
      logger.error("Failed to fetch candidate submission", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/api/evaluations/assessment/:assessmentId", async (req, res) => {
    try {
      const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const submissions = await candidateSessionStore.listSubmissions({
        assessmentId: req.params.assessmentId,
        limit: rawLimit,
      });
      res.json({
        assessmentId: req.params.assessmentId,
        submissions: await attachCalculationDetailsToMany(submissions, candidateSessionStore),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown assessment evaluation lookup error";
      logger.error("Failed to fetch assessment evaluation results", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/api/evaluations/:sessionId", async (req, res) => {
    try {
      const result = await candidateSessionStore.findSubmissionBySessionId(req.params.sessionId);
      if (!result) {
        res.status(404).json({ status: "error", message: "Evaluation not found" });
        return;
      }
      res.json(await attachCalculationDetails(result, candidateSessionStore));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown evaluation lookup error";
      logger.error("Failed to fetch evaluation result", { message });
      res.status(500).json({ status: "error", message });
    }
  });

  app.get("/v1/models", async (req, res) => {
    try {
      await handleAiModels(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown AI proxy error";
      logger.error("Failed to list AI proxy models", { message });
      res.status(500).json({ error: { message } });
    }
  });

  app.post("/v1/chat/completions", async (req, res) => {
    try {
      await handleAiChatCompletions(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown AI proxy error";
      logger.error("Failed to proxy AI chat completion", { message });
      res.status(500).json({ error: { message } });
    }
  });

  app.post("/generate-assessment", async (req, res) => {
    try {
      const payload = req.body as GenerateAssessmentRequest;
      validateGenerateAssessmentRequest(payload);
      const job = jobStore.createJob({
        operation: "generate-assessment",
        runner: () => generateAssessment(payload),
      });
      res.status(202).location(job.pollUrl).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const response: SeedBugError = {
        status: "error",
        message,
      };

      logger.error("Failed to generate assessment", { message });
      res.status(statusCodeForError(message)).json(response);
    }
  });

  app.get("/jobs/:jobId", (req, res) => {
    const job = jobStore.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({
        status: "error",
        message: "Job not found",
      } satisfies SeedBugError);
      return;
    }

    res.json(job);
  });

  app.get("/generate-assessment/jobs/:jobId", (req, res) => {
    handleOperationJobLookup(req.params.jobId, "generate-assessment", res);
  });

  return app;
}

function renderPlainError(message: string): string {
  return `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(message)}</pre>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function handleOperationJobLookup(
  jobId: string,
  operation: JobOperation,
  res: express.Response,
): void {
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({
      status: "error",
      message: "Job not found",
    } satisfies SeedBugError);
    return;
  }

  if (job.operation !== operation) {
    res.status(404).json({
      status: "error",
      message: "Job not found for requested operation",
    } satisfies SeedBugError);
    return;
  }

  res.json(job);
}

function statusCodeForError(message: string): number {
  if (
    message === "repoPath is required" ||
    message === "artifactPath is required" ||
    message === "Job not found" ||
    message === "Repo path does not exist" ||
    message === "Repo path is not a directory" ||
    message === "Job not found for requested operation" ||
    message === "artifactPath must point to an existing assessment artifact" ||
    message === "assessment.json is invalid" ||
    message === "Repo path does not exist or is not a supported GitHub repo path" ||
    message === "bugDiversification must be a boolean" ||
    message === "orchestrationMode must be standard or legacy" ||
    message === "adversarialSolver must be a boolean" ||
    message.startsWith("difficulty must be") ||
    message.startsWith("bugCount must be") ||
    message.startsWith("designCount must be") ||
    message.startsWith("seedAttemptCount must be")
  ) {
    return 400;
  }

  return 500;
}
