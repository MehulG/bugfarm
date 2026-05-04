import { copyFile } from "node:fs/promises";
import path from "node:path";
import { seedBug } from "../bugfarm/seedBug.js";
import { resolveRepoTarget } from "../bugfarm/repoTarget.js";
import { getChangedFiles } from "../bugfarm/git.js";
import {
  buildRubric,
  createArtifactPaths,
  writeAssessmentMetadata,
  writeJsonFile,
} from "./artifacts.js";
import { createAndValidateHiddenTests } from "./hiddenTests.js";
import { copyRepo, prepareCandidateRepo, writeBugPatch } from "./repoOps.js";
import { writeCandidateTask } from "./task.js";
import type {
  AssessmentMetadata,
  GenerateAssessmentRequest,
  GenerateAssessmentSuccess,
} from "./types.js";

export async function generateAssessment(
  request: GenerateAssessmentRequest,
): Promise<GenerateAssessmentSuccess> {
  validateGenerateAssessmentRequest(request);

  const assessmentName = request.assessmentName || "BugFarm Debugging Assessment";
  const repoTarget = await resolveRepoTarget(request.repoPath);
  const artifactPaths = await createArtifactPaths(assessmentName);

  await copyRepo(repoTarget.repoPath, artifactPaths.baselineRepoPath);
  await copyRepo(artifactPaths.baselineRepoPath, artifactPaths.candidateRepoPath);

  const seedResult = await seedBug({
    ...request,
    repoPath: artifactPaths.candidateRepoPath,
  });

  await copyFile(
    path.join(artifactPaths.candidateRepoPath, "BUG_REPORT.md"),
    artifactPaths.bugReportPath,
  );
  await prepareCandidateRepo(artifactPaths.candidateRepoPath);
  const filesChanged = await getChangedFiles(artifactPaths.candidateRepoPath);
  await writeBugPatch(artifactPaths.candidateRepoPath, artifactPaths.patchPath);
  await writeCandidateTask({
    taskPath: artifactPaths.taskPath,
    assessmentName,
    request,
    filesChanged,
  });

  const validation = await createAndValidateHiddenTests({
    baselineRepoPath: artifactPaths.baselineRepoPath,
    candidateRepoPath: artifactPaths.candidateRepoPath,
    hiddenTestsPath: artifactPaths.hiddenTestsPath,
    language: request.language,
  });

  const rubric = buildRubric({
    difficulty: request.difficulty,
    bugCount: seedResult.bugCount,
    area: request.area,
    language: request.language,
    role: request.role,
  });

  await writeJsonFile(artifactPaths.rubricPath, rubric);

  const metadata: AssessmentMetadata = {
    assessmentId: artifactPaths.assessmentId,
    assessmentName,
    createdAt: new Date().toISOString(),
    requestedRepoPath: repoTarget.requestedRepoPath,
    repoSource: repoTarget.repoSource,
    artifactPath: artifactPaths.artifactPath,
    baselineRepoPath: artifactPaths.baselineRepoPath,
    candidateRepoPath: artifactPaths.candidateRepoPath,
    hiddenTestsPath: artifactPaths.hiddenTestsPath,
    bugReportPath: artifactPaths.bugReportPath,
    taskPath: artifactPaths.taskPath,
    patchPath: artifactPaths.patchPath,
    rubricPath: artifactPaths.rubricPath,
    summary: seedResult.summary,
    difficulty: seedResult.difficulty,
    bugCount: seedResult.bugCount,
    filesChanged,
    validation,
    rubric,
  };

  await writeAssessmentMetadata(metadata);

  return {
    status: "success",
    assessmentId: metadata.assessmentId,
    assessmentName: metadata.assessmentName,
    artifactPath: metadata.artifactPath,
    candidateRepoPath: metadata.candidateRepoPath,
    baselineRepoPath: metadata.baselineRepoPath,
    hiddenTestsPath: metadata.hiddenTestsPath,
    validation: metadata.validation,
    filesChanged: metadata.filesChanged,
    summary: metadata.summary,
    difficulty: metadata.difficulty,
    bugCount: metadata.bugCount,
    bugReportPath: metadata.bugReportPath,
    taskPath: metadata.taskPath,
    patchPath: metadata.patchPath,
    rubricPath: metadata.rubricPath,
  };
}

function validateGenerateAssessmentRequest(request: GenerateAssessmentRequest): void {
  if (!request || typeof request.repoPath !== "string" || request.repoPath.trim() === "") {
    throw new Error("repoPath is required");
  }

  if (request.difficulty && !["easy", "medium", "hard"].includes(request.difficulty)) {
    throw new Error("difficulty must be easy, medium, or hard");
  }

  const bugCount = request.bugCount ?? request.numberOfBugs ?? 1;
  if (!Number.isInteger(bugCount)) {
    throw new Error("bugCount must be an integer");
  }

  if (bugCount < 1 || bugCount > 10) {
    throw new Error("bugCount must be between 1 and 10");
  }
}
