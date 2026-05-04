import type { BugDifficulty, SeedBugRequest } from "../bugfarm/types.js";

export type GenerateAssessmentRequest = SeedBugRequest & {
  role?: string;
  assessmentName?: string;
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
  baseline: AssessmentValidationRun;
  candidate: AssessmentValidationRun;
  notes: string[];
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
  validation: AssessmentValidation;
  rubric: AssessmentRubric;
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
