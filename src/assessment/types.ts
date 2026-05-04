import type { BugDifficulty, SeedBugRequest } from "../bugfarm/types.js";

export type GenerateBugRequest = SeedBugRequest & {
  role?: string;
  assessmentName?: string;
};

export type GenerateAssessmentRequest = SeedBugRequest & {
  role?: string;
  assessmentName?: string;
};

export type GenerateTestsRequest = {
  artifactPath: string;
  language?: string;
};

export type AssessmentValidationRun = {
  target: "baseline" | "candidate";
  status: "passed" | "failed" | "skipped";
  command?: string;
  exitCode?: number;
  output?: string;
  reason?: string;
};

export type AssessmentValidation = {
  status: "passed" | "failed" | "skipped";
  ecosystem: "node" | "python" | "unknown";
  hiddenTestsPath: string;
  retryCount: number;
  wrapperEntrypoints: string[];
  targetSymbols: string[];
  baseline: AssessmentValidationRun;
  candidate: AssessmentValidationRun;
  notes: string[];
  rejectedReason?: string;
};

export type AssessmentRubric = {
  dimensions: Array<{
    name: string;
    description: string;
    weight: number;
  }>;
  requestedDifficulty: BugDifficulty | "medium";
  requestedBugCount: number;
  area?: string;
  language?: string;
  role?: string;
};

export type AssessmentMetadata = {
  assessmentId: string;
  assessmentName: string;
  createdAt: string;
  stage: "bug-generated" | "test-generation-failed" | "assessment-complete";
  requestedRepoPath: string;
  repoSource: "local" | "github";
  artifactPath: string;
  baselineRepoPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  bugReportPath: string;
  taskPath: string;
  patchPath: string;
  rubricPath: string;
  summary: string;
  difficulty: string;
  bugCount: number;
  filesChanged: string[];
  validation?: AssessmentValidation;
  rubric: AssessmentRubric;
};

export type GenerateBugSuccess = {
  status: "success";
  assessmentId: string;
  assessmentName: string;
  requestedRepoPath: string;
  repoSource: "local" | "github";
  artifactPath: string;
  candidateRepoPath: string;
  baselineRepoPath: string;
  hiddenTestsPath: string;
  filesChanged: string[];
  summary: string;
  difficulty: string;
  bugCount: number;
  bugReportPath: string;
  taskPath: string;
  patchPath: string;
  rubricPath: string;
};

export type GenerateTestsSuccess = {
  status: "success";
  assessmentId: string;
  assessmentName: string;
  artifactPath: string;
  candidateRepoPath: string;
  baselineRepoPath: string;
  hiddenTestsPath: string;
  validation: AssessmentValidation;
  filesChanged: string[];
  bugReportPath: string;
  taskPath: string;
  patchPath: string;
  rubricPath: string;
};

export type GenerateAssessmentSuccess = {
  status: "success";
  assessmentId: string;
  assessmentName: string;
  artifactPath: string;
  candidateRepoPath: string;
  baselineRepoPath: string;
  hiddenTestsPath: string;
  validation: AssessmentValidation;
  filesChanged: string[];
  summary: string;
  difficulty: string;
  bugCount: number;
  bugReportPath: string;
  taskPath: string;
  patchPath: string;
  rubricPath: string;
};
