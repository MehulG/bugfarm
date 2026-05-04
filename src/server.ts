import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import { generateAssessment } from "./assessment/generateAssessment.js";
import type { GenerateAssessmentRequest } from "./assessment/types.js";
import { seedBug } from "./bugfarm/seedBug.js";
import type { SeedBugError, SeedBugRequest } from "./bugfarm/types.js";
import { openApiDocument } from "./openapi.js";
import { logger } from "./utils/logger.js";

export function createServer(): express.Express {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

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

  app.post("/seed-bug", async (req, res) => {
    try {
      const payload = req.body as SeedBugRequest;
      const result = await seedBug(payload);
      res.json(result);
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

  app.post("/generate-assessment", async (req, res) => {
    try {
      const payload = req.body as GenerateAssessmentRequest;
      const result = await generateAssessment(payload);
      res.json(result);
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

  return app;
}

function statusCodeForError(message: string): number {
  if (
    message === "repoPath is required" ||
    message === "Repo path does not exist" ||
    message === "Repo path is not a directory" ||
    message === "Repo path does not exist or is not a supported GitHub repo path" ||
    message.startsWith("difficulty must be") ||
    message.startsWith("bugCount must be")
  ) {
    return 400;
  }

  return 500;
}
