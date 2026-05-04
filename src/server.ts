import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import { generateAssessment } from "./assessment/generateAssessment.js";
import { generateBugArtifact, validateGenerateBugRequest } from "./assessment/generateBug.js";
import { generateTestsForArtifact, validateGenerateTestsRequest } from "./assessment/generateTests.js";
import type {
  GenerateAssessmentRequest,
  GenerateBugRequest,
  GenerateTestsRequest,
} from "./assessment/types.js";
import { validateGenerateAssessmentRequest } from "./assessment/generateAssessment.js";
import { seedBug, validateSeedBugRequest } from "./bugfarm/seedBug.js";
import type { SeedBugError, SeedBugRequest } from "./bugfarm/types.js";
import { jobStore } from "./jobs/store.js";
import type { JobOperation } from "./jobs/types.js";
import { openApiDocument } from "./openapi.js";
import { logger } from "./utils/logger.js";
import {
  handleArtifactDownload,
  handleCandidateLaunch,
  handleCandidateLaunchStatus,
  handleCandidatePasswordReset,
} from "./candidate/flow.js";

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
      pageTitle: "BugFarm API Reference",
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

  app.post("/candidate/launch/:launchToken/reset-password", async (req, res) => {
    try {
      await handleCandidatePasswordReset(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown password reset error";
      logger.error("Failed to reset candidate password", { message });
      res.status(500).json({ status: "error", message });
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

  app.post("/seed-bug", async (req, res) => {
    try {
      const payload = req.body as SeedBugRequest;
      await validateSeedBugRequest(payload);
      const job = jobStore.createJob({
        operation: "seed-bug",
        runner: () => seedBug(payload),
      });
      res.status(202).location(job.pollUrl).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const response: SeedBugError = {
        status: "error",
        message,
      };

      logger.error("Failed to seed bug", { message });
      res.status(statusCodeForError(message)).json(response);
    }
  });

  app.post("/generate-bug", async (req, res) => {
    try {
      const payload = req.body as GenerateBugRequest;
      validateGenerateBugRequest(payload);
      const job = jobStore.createJob({
        operation: "generate-bug",
        runner: () => generateBugArtifact(payload),
      });
      res.status(202).location(job.pollUrl).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const response: SeedBugError = {
        status: "error",
        message,
      };

      logger.error("Failed to queue generate-bug", { message });
      res.status(statusCodeForError(message)).json(response);
    }
  });

  app.post("/generate-tests", async (req, res) => {
    try {
      const payload = req.body as GenerateTestsRequest;
      await validateGenerateTestsRequest(payload);
      const job = jobStore.createJob({
        operation: "generate-tests",
        runner: () => generateTestsForArtifact(payload),
      });
      res.status(202).location(job.pollUrl).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const response: SeedBugError = {
        status: "error",
        message,
      };

      logger.error("Failed to queue generate-tests", { message });
      res.status(statusCodeForError(message)).json(response);
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

  app.get("/seed-bug/jobs/:jobId", (req, res) => {
    handleOperationJobLookup(req.params.jobId, "seed-bug", res);
  });

  app.get("/generate-assessment/jobs/:jobId", (req, res) => {
    handleOperationJobLookup(req.params.jobId, "generate-assessment", res);
  });

  app.get("/generate-bug/jobs/:jobId", (req, res) => {
    handleOperationJobLookup(req.params.jobId, "generate-bug", res);
  });

  app.get("/generate-tests/jobs/:jobId", (req, res) => {
    handleOperationJobLookup(req.params.jobId, "generate-tests", res);
  });

  return app;
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
    message.startsWith("difficulty must be") ||
    message.startsWith("bugCount must be")
  ) {
    return 400;
  }

  return 500;
}
