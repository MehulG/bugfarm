import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type express from "express";
import { generateAssessment, validateGenerateAssessmentRequest } from "../assessment/generateAssessment.js";
import type { GenerateAssessmentRequest, GenerateAssessmentSuccess } from "../assessment/types.js";
import type { BugDifficulty } from "../codesheep/types.js";
import { candidateSessionStore, type CandidateSessionStore } from "../candidate/store.js";
import { attachCalculationDetails } from "../candidate/evaluationDetails.js";
import { jobStore } from "../jobs/store.js";
import type { JobAcceptedResponse } from "../jobs/types.js";
import { CompanyStore, companyStore } from "./store.js";
import { DEFAULT_COMPANY_ID, type CompanyAssignmentRecord, type CompanyCandidate } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_EVIDENCE_TEXT_BYTES = 256 * 1024;

export type CompanyRoutesDeps = {
  companyStore?: CompanyStore;
  candidateStore?: CandidateSessionStore;
  jobStore?: typeof jobStore;
  generateAssessment?: (request: GenerateAssessmentRequest) => Promise<GenerateAssessmentSuccess>;
};

export function registerCompanyRoutes(app: express.Express, deps: CompanyRoutesDeps = {}): void {
  const store = deps.companyStore ?? companyStore;
  const submissions = deps.candidateStore ?? candidateSessionStore;
  const jobs = deps.jobStore ?? jobStore;
  const assessmentGenerator = deps.generateAssessment ?? generateAssessment;

  app.get("/api/company/candidates", async (_req, res) => {
    try {
      res.json({ candidates: await store.listCandidates(DEFAULT_COMPANY_ID) });
    } catch (error) {
      sendError(res, error, "Failed to list company candidates");
    }
  });

  app.post("/api/company/candidates", async (req, res) => {
    try {
      const input = parseCreateCandidate(req.body);
      const candidate = await store.createCandidate({
        ...input,
        companyId: DEFAULT_COMPANY_ID,
      });
      res.status(201).json({ candidate });
    } catch (error) {
      sendError(res, error, "Failed to create company candidate");
    }
  });

  app.get("/api/company/candidates/:candidateId", async (req, res) => {
    try {
      const candidate = await store.findCandidate(req.params.candidateId, DEFAULT_COMPANY_ID);
      if (!candidate) {
        res.status(404).json({ status: "error", message: "Candidate not found" });
        return;
      }

      const assignmentHistory = await store.listAssignmentsForCandidate({
        candidateId: candidate.candidateId,
        companyId: DEFAULT_COMPANY_ID,
      });
      const currentAssignment = assignmentHistory[0];
      const latestSubmission = currentAssignment?.assessmentId
        ? (await submissions.listSubmissions({ assessmentId: currentAssignment.assessmentId, limit: 1 }))[0]
        : undefined;

      res.json({
        candidate,
        currentAssignment: currentAssignment
          ? {
              ...currentAssignment,
              evidence: await readAssignmentEvidence(currentAssignment),
            }
          : undefined,
        assignmentHistory,
        latestSubmission: latestSubmission
          ? await attachCalculationDetails(latestSubmission, submissions)
          : undefined,
      });
    } catch (error) {
      sendError(res, error, "Failed to fetch company candidate");
    }
  });

  app.post("/api/company/candidates/:candidateId/assignments", async (req, res) => {
    let assignment: CompanyAssignmentRecord | undefined;
    try {
      const candidate = await store.findCandidate(req.params.candidateId, DEFAULT_COMPANY_ID);
      if (!candidate) {
        res.status(404).json({ status: "error", message: "Candidate not found" });
        return;
      }

      const request = buildGenerateAssessmentRequest(candidate, req.body);
      validateGenerateAssessmentRequest(request);
      assignment = await store.createAssignment({ candidate, request });

      const accepted = jobs.createJob({
        operation: "generate-assessment",
        runner: async () => {
          await store.markAssignmentRunning({
            assignmentRecordId: assignment!.assignmentRecordId,
            companyId: DEFAULT_COMPANY_ID,
          });
          try {
            const result = await assessmentGenerator(request);
            await store.markAssignmentSucceeded({
              assignmentRecordId: assignment!.assignmentRecordId,
              companyId: DEFAULT_COMPANY_ID,
              result,
            });
            return result;
          } catch (error) {
            await store.markAssignmentFailed({
              assignmentRecordId: assignment!.assignmentRecordId,
              companyId: DEFAULT_COMPANY_ID,
              errorText: error instanceof Error ? error.message : "Unknown assignment generation error",
            });
            throw error;
          }
        },
      });

      await store.setAssignmentJobId({
        assignmentRecordId: assignment.assignmentRecordId,
        companyId: DEFAULT_COMPANY_ID,
        generationJobId: accepted.jobId,
      });

      res.status(202).location(accepted.pollUrl).json({
        ...accepted,
        assignmentRecordId: assignment.assignmentRecordId,
      });
    } catch (error) {
      sendError(res, error, "Failed to create company assignment");
    }
  });

  app.get("/api/company/candidates/:candidateId/assignments/:assignmentRecordId/job", async (req, res) => {
    try {
      const assignment = await store.findAssignment({
        candidateId: req.params.candidateId,
        assignmentRecordId: req.params.assignmentRecordId,
        companyId: DEFAULT_COMPANY_ID,
      });
      if (!assignment) {
        res.status(404).json({ status: "error", message: "Assignment not found" });
        return;
      }

      const job = assignment.generationJobId ? jobs.getJob(assignment.generationJobId) : undefined;
      res.json({ assignment, job });
    } catch (error) {
      sendError(res, error, "Failed to fetch assignment job");
    }
  });
}

function parseCreateCandidate(body: unknown): {
  name: string;
  designation: string;
  githubRepo?: string;
} {
  const value = asRecord(body);
  const name = readRequiredString(value, "name");
  const designation = readRequiredString(value, "designation");
  const githubRepo = readOptionalString(value, "githubRepo");
  return { name, designation, githubRepo };
}

function buildGenerateAssessmentRequest(
  candidate: CompanyCandidate,
  body: unknown,
): GenerateAssessmentRequest {
  const value = asRecord(body);
  const repoPath = readRequiredString(value, "repoPath");
  const difficulty = readRequiredDifficulty(value);
  const bugCount = readOptionalInteger(value, "bugCount");
  const designCount = readOptionalInteger(value, "designCount");
  const seedAttemptCount = readOptionalInteger(value, "seedAttemptCount");
  const bugDiversification = readOptionalBoolean(value, "bugDiversification");
  const adversarialSolver = readOptionalBoolean(value, "adversarialSolver");
  const orchestrationMode = readOptionalString(value, "orchestrationMode");
  const assessmentName =
    readOptionalString(value, "assessmentName") ||
    `${candidate.name} ${candidate.designation} Assignment`;

  return {
    repoPath,
    difficulty,
    area: readOptionalString(value, "area"),
    language: readOptionalString(value, "language"),
    bugCount,
    bugDiversification,
    role: readOptionalString(value, "role") || candidate.designation,
    assessmentName,
    orchestrationMode:
      orchestrationMode === "standard" || orchestrationMode === "legacy"
        ? orchestrationMode
        : undefined,
    designCount,
    seedAttemptCount,
    adversarialSolver,
  };
}

async function readAssignmentEvidence(assignment: CompanyAssignmentRecord) {
  const [patch, bugReport, sourceCommit] = await Promise.all([
    readSafeText(assignment.patchPath),
    readSafeText(assignment.bugReportPath),
    readSourceCommit(assignment.baselineRepoPath),
  ]);

  return {
    patchText: patch.text,
    patchTextTruncated: patch.truncated,
    bugReportText: bugReport.text,
    bugReportTextTruncated: bugReport.truncated,
    sourceCommit,
  };
}

async function readSafeText(filePath: string | undefined): Promise<{
  text?: string;
  truncated: boolean;
}> {
  if (!filePath) {
    return { truncated: false };
  }
  try {
    const buffer = await readFile(filePath);
    const truncated = buffer.length > MAX_EVIDENCE_TEXT_BYTES;
    const text = buffer.subarray(0, MAX_EVIDENCE_TEXT_BYTES).toString("utf8");
    return { text, truncated };
  } catch {
    return { truncated: false };
  }
}

async function readSourceCommit(repoPath: string | undefined): Promise<string | undefined> {
  if (!repoPath) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const raw = value[field];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }
  return raw.trim();
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function readOptionalInteger(value: Record<string, unknown>, field: string): number | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error(`${field} must be an integer`);
  }
  return raw;
}

function readRequiredDifficulty(value: Record<string, unknown>): BugDifficulty {
  const difficulty = readRequiredString(value, "difficulty");
  if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
    throw new Error("difficulty must be easy, medium, or hard");
  }
  return difficulty;
}

function readOptionalBoolean(value: Record<string, unknown>, field: string): boolean | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return raw;
}

function sendError(res: express.Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  const status =
    message.includes("not found") || message.includes("Not found")
      ? 404
      : isValidationError(message)
        ? 400
        : 500;
  res.status(status).json({ status: "error", message });
}

function isValidationError(message: string): boolean {
  return (
    message.endsWith("is required") ||
    message.endsWith("must be a string") ||
    message.endsWith("must be an object") ||
    message.endsWith("must be an integer") ||
    message.endsWith("must be a boolean") ||
    message.startsWith("difficulty must be") ||
    message.startsWith("bugCount must be") ||
    message.startsWith("designCount must be") ||
    message.startsWith("seedAttemptCount must be") ||
    message === "repoPath is required" ||
    message === "Repo path does not exist or is not a supported GitHub repo path" ||
    message === "orchestrationMode must be standard or legacy" ||
    message === "adversarialSolver must be a boolean" ||
    message === "bugDiversification must be a boolean"
  );
}

export type CompanyAssignmentAcceptedResponse = JobAcceptedResponse & {
  assignmentRecordId: string;
};
