import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { getChangedFiles } from "../bugfarm/git.js";
import { writeAssessmentMetadata } from "./artifacts.js";
import { createAndValidateHiddenTests } from "./hiddenTests.js";
import type {
  AssessmentMetadata,
  GenerateTestsRequest,
  GenerateTestsSuccess,
} from "./types.js";

export async function generateTestsForArtifact(
  request: GenerateTestsRequest,
): Promise<GenerateTestsSuccess> {
  validateGenerateTestsRequest(request);

  const artifactPath = path.resolve(request.artifactPath);
  const metadata = await loadAssessmentMetadata(artifactPath);
  const filesChanged = await getChangedFiles(metadata.candidateRepoPath);

  const validation = await createAndValidateHiddenTests({
    artifactPath: metadata.artifactPath,
    baselineRepoPath: metadata.baselineRepoPath,
    candidateRepoPath: metadata.candidateRepoPath,
    hiddenTestsPath: metadata.hiddenTestsPath,
    bugReportPath: metadata.bugReportPath,
    filesChanged,
    language: request.language,
  });

  if (validation.status !== "passed") {
    const failedMetadata: AssessmentMetadata = {
      ...metadata,
      stage: "test-generation-failed",
      filesChanged,
      validation,
    };
    await writeAssessmentMetadata(failedMetadata);

    const reason =
      validation.rejectedReason ||
      validation.candidate.reason ||
      validation.baseline.reason ||
      "Assessment validation failed.";
    throw new Error(`Assessment validation failed: ${reason}`);
  }

  const updated: AssessmentMetadata = {
    ...metadata,
    stage: "assessment-complete",
    filesChanged,
    validation,
  };

  await writeAssessmentMetadata(updated);

  return {
    status: "success",
    assessmentId: updated.assessmentId,
    assessmentName: updated.assessmentName,
    artifactPath: updated.artifactPath,
    candidateRepoPath: updated.candidateRepoPath,
    baselineRepoPath: updated.baselineRepoPath,
    hiddenTestsPath: updated.hiddenTestsPath,
    validation,
    filesChanged: updated.filesChanged,
    bugReportPath: updated.bugReportPath,
    taskPath: updated.taskPath,
    patchPath: updated.patchPath,
    rubricPath: updated.rubricPath,
  };
}

export async function validateGenerateTestsRequest(
  request: GenerateTestsRequest,
): Promise<void> {
  if (!request || typeof request.artifactPath !== "string" || request.artifactPath.trim() === "") {
    throw new Error("artifactPath is required");
  }

  const artifactPath = path.resolve(request.artifactPath);
  const assessmentJsonPath = path.join(artifactPath, "assessment.json");

  try {
    await access(assessmentJsonPath);
  } catch {
    throw new Error("artifactPath must point to an existing assessment artifact");
  }
}

async function loadAssessmentMetadata(artifactPath: string): Promise<AssessmentMetadata> {
  const raw = await readFile(path.join(artifactPath, "assessment.json"), "utf8");
  const parsed = JSON.parse(raw) as AssessmentMetadata;

  if (!parsed || typeof parsed !== "object" || !parsed.artifactPath) {
    throw new Error("assessment.json is invalid");
  }

  return parsed;
}
