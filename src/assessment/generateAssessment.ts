import { generateBugArtifact, validateGenerateBugRequest } from "./generateBug.js";
import { generateTestsForArtifact } from "./generateTests.js";
import type { GenerateAssessmentRequest, GenerateAssessmentSuccess } from "./types.js";
import { createCandidateLaunchForAssessment } from "../candidate/flow.js";

export async function generateAssessment(
  request: GenerateAssessmentRequest,
): Promise<GenerateAssessmentSuccess> {
  validateGenerateAssessmentRequest(request);
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
  };
}

export function validateGenerateAssessmentRequest(request: GenerateAssessmentRequest): void {
  validateGenerateBugRequest(request);
}
