import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { AssessmentMetadata, AssessmentRubric } from "./types.js";

export type ArtifactPaths = {
  assessmentId: string;
  artifactPath: string;
  baselineRepoPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  reportsPath: string;
  patchesPath: string;
  candidatePath: string;
  bugReportPath: string;
  taskPath: string;
  patchPath: string;
  rubricPath: string;
  assessmentJsonPath: string;
};

export async function createArtifactPaths(assessmentName?: string): Promise<ArtifactPaths> {
  const assessmentId = createAssessmentId(assessmentName);
  const artifactPath = path.resolve(config.assessmentOutputDir, assessmentId);
  const baselineRepoPath = path.join(artifactPath, "baseline-repo");
  const candidateRepoPath = path.join(artifactPath, "candidate-repo");
  const hiddenTestsPath = path.join(artifactPath, "hidden-tests");
  const reportsPath = path.join(artifactPath, "reports");
  const patchesPath = path.join(artifactPath, "patches");
  const candidatePath = path.join(artifactPath, "candidate");

  await Promise.all([
    mkdir(baselineRepoPath, { recursive: true }),
    mkdir(candidateRepoPath, { recursive: true }),
    mkdir(hiddenTestsPath, { recursive: true }),
    mkdir(reportsPath, { recursive: true }),
    mkdir(patchesPath, { recursive: true }),
    mkdir(candidatePath, { recursive: true }),
  ]);

  return {
    assessmentId,
    artifactPath,
    baselineRepoPath,
    candidateRepoPath,
    hiddenTestsPath,
    reportsPath,
    patchesPath,
    candidatePath,
    bugReportPath: path.join(reportsPath, "BUG_REPORT.md"),
    taskPath: path.join(candidatePath, "TASK.md"),
    patchPath: path.join(patchesPath, "bug.patch"),
    rubricPath: path.join(artifactPath, "rubric.json"),
    assessmentJsonPath: path.join(artifactPath, "assessment.json"),
  };
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeAssessmentMetadata(metadata: AssessmentMetadata): Promise<void> {
  await writeJsonFile(path.join(metadata.artifactPath, "assessment.json"), metadata);
}

export function buildRubric(input: {
  difficulty?: AssessmentRubric["requestedDifficulty"];
  bugCount: number;
  area?: string;
  language?: string;
  role?: string;
}): AssessmentRubric {
  return {
    requestedDifficulty: input.difficulty || "medium",
    requestedBugCount: input.bugCount,
    area: input.area,
    language: input.language,
    role: input.role,
    dimensions: [
      {
        name: "correctness",
        description: "Fixes the seeded behavior without introducing regressions.",
        weight: 35,
      },
      {
        name: "minimality",
        description: "Keeps the solution focused and avoids unrelated changes.",
        weight: 15,
      },
      {
        name: "code_quality",
        description: "Uses idiomatic patterns consistent with the repository.",
        weight: 15,
      },
      {
        name: "test_coverage",
        description: "Adds or updates meaningful tests when appropriate.",
        weight: 15,
      },
      {
        name: "debugging_process",
        description: "Shows clear investigation, validation, and recovery from false starts.",
        weight: 10,
      },
      {
        name: "ai_assistant_difficulty",
        description: "Reflects how difficult the task should be when using AI coding assistants.",
        weight: 10,
      },
    ],
  };
}

function createAssessmentId(assessmentName?: string): string {
  const slug = slugify(assessmentName || "assessment");
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = randomBytes(4).toString("hex");
  return `${slug}-${timestamp}-${suffix}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "assessment";
}
