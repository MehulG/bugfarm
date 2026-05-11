import { generateBugArtifact, validateGenerateBugRequest } from "./generateBug.js";
import { generateTestsForArtifact } from "./generateTests.js";
import type { GenerateAssessmentRequest, GenerateAssessmentSuccess } from "./types.js";
import { createCandidateLaunchForAssessment } from "../candidate/flow.js";
import { generateOrchestratedAssessment } from "./orchestration.js";

export async function generateAssessment(
  request: GenerateAssessmentRequest,
): Promise<GenerateAssessmentSuccess> {
  validateGenerateAssessmentRequest(request);
  if ((request.orchestrationMode ?? "standard") !== "legacy") {
    return generateOrchestratedAssessment(request);
  }

  const bugArtifact = await generateBugArtifact(request);
  const tests = await generateTestsForArtifact({
    artifactPath: bugArtifact.artifactPath,
    language: request.language,
  });
  const candidateLaunch = await createCandidateLaunchForAssessment({
    assessmentId: bugArtifact.assessmentId,
    artifactPath: bugArtifact.artifactPath,
  });

  return {
    status: "success",
    assessmentId: bugArtifact.assessmentId,
    assessmentName: bugArtifact.assessmentName,
    candidateLaunchUrl: candidateLaunch.candidateLaunchUrl,
    artifactPath: bugArtifact.artifactPath,
    candidateRepoPath: bugArtifact.candidateRepoPath,
    baselineRepoPath: bugArtifact.baselineRepoPath,
    hiddenTestsPath: bugArtifact.hiddenTestsPath,
    validation: tests.validation,
    filesChanged: tests.filesChanged,
    summary: bugArtifact.summary,
    difficulty: bugArtifact.difficulty,
    bugCount: bugArtifact.bugCount,
    bugReportPath: bugArtifact.bugReportPath,
    taskPath: bugArtifact.taskPath,
    patchPath: bugArtifact.patchPath,
    rubricPath: bugArtifact.rubricPath,
    orchestration: { mode: "legacy" },
  };
}

export function validateGenerateAssessmentRequest(request: GenerateAssessmentRequest): void {
  validateGenerateBugRequest(request);
  if (
    request.orchestrationMode !== undefined &&
    !["standard", "legacy"].includes(request.orchestrationMode)
  ) {
    throw new Error("orchestrationMode must be standard or legacy");
  }
  validateOptionalInteger(request.designCount, "designCount", 1, 10);
  validateOptionalInteger(request.seedAttemptCount, "seedAttemptCount", 1, 10);
  if (request.adversarialSolver !== undefined && typeof request.adversarialSolver !== "boolean") {
    throw new Error("adversarialSolver must be a boolean");
  }
}

function validateOptionalInteger(
  value: number | undefined,
  fieldName: string,
  min: number,
  max: number,
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
}
