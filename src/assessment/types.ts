import type { BugDifficulty, SeedBugRequest } from "../codesheep/types.js";

export type GenerateBugRequest = SeedBugRequest & {
  role?: string;
  assessmentName?: string;
};

export type GenerateAssessmentRequest = SeedBugRequest & {
  role?: string;
  assessmentName?: string;
  orchestrationMode?: "standard" | "legacy";
  designCount?: number;
  seedAttemptCount?: number;
  adversarialSolver?: boolean;
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

export type SubmissionHiddenTestCaseResult = {
  caseId: string;
  category: "control" | "exposes_bug";
  matchedBaseline: boolean;
  output?: string;
};

export type SubmissionHiddenTestResult = {
  status: "passed" | "failed";
  ecosystem: "node" | "python" | "unknown";
  wrapperEntrypoints: string[];
  command?: string;
  output?: string;
  notes: string[];
  cases: SubmissionHiddenTestCaseResult[];
  controlPassed: number;
  controlTotal: number;
  exposingPassed: number;
  exposingTotal: number;
  score: number;
  reason?: string;
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

export type RepoProfile = {
  workflows: string[];
  highValueTargets: string[];
  edgeCases: string[];
  testableEntryPoints: string[];
  notes?: string;
};

export type BugDesign = {
  id: string;
  title: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  targetFiles: string[];
  behaviorChange: string;
  whyRealistic: string;
  hiddenTestStrategy: string[];
  risk: "low" | "medium" | "high";
};

export type AdversarialSolverResult = {
  attempted: boolean;
  solved: boolean;
  hiddenScore?: number;
  filesInspected?: number;
  changedFiles: string[];
  summary: string;
  tooEasy: boolean;
};

export type AssignmentQualityReport = {
  accepted: boolean;
  score: number;
  reasons: string[];
  risks: string[];
};

export type OrchestrationAttempt = {
  design: BugDesign;
  artifactPath?: string;
  filesChanged: string[];
  validationStatus?: AssessmentValidation["status"];
  rejectedReason?: string;
  solver?: AdversarialSolverResult;
  quality?: AssignmentQualityReport;
};

export type AssessmentOrchestrationEvidence = {
  mode: "standard" | "legacy";
  profile?: RepoProfile;
  designs?: BugDesign[];
  selectedDesign?: BugDesign;
  attempts?: OrchestrationAttempt[];
};

export type CandidateEvaluationDimensionScore = {
  name: string;
  weight: number;
  score: number;
  reason: string;
};

export type CandidateFinalVerdict = "pass" | "fail";

export type CandidateSubmissionStatus = "queued" | "running" | "succeeded" | "failed";

export type CandidateEvaluationAiUsageSummary = {
  requestCount: number;
  successfulRequestCount: number;
  failedRequestCount: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
  firstAiCallAt?: string;
  lastAiCallAt?: string;
};

export type CandidateEvaluationAiProxyRequest = {
  createdAt: string;
  model: string;
  requestJson: string;
  responseBody?: string;
  status: "succeeded" | "failed";
  providerStatus?: number;
  errorText?: string;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
};

export type CandidateSubmissionGitEvidence = {
  branch: string;
  baselineCommit: string;
  submittedCommit: string;
  changedFiles: string[];
};

export type CandidateEvaluationCalculationDetails = {
  scoreFormula: string;
  weightedScoreInputs: Array<{
    name: string;
    weight: number;
    score: number;
    weightedContribution: number;
    reason: string;
  }>;
  hiddenTestResult?: SubmissionHiddenTestResult;
  dimensionScores?: CandidateEvaluationDimensionScore[];
  aiUsageSummary: CandidateEvaluationAiUsageSummary;
  aiProxyRequests: CandidateEvaluationAiProxyRequest[];
  git?: CandidateSubmissionGitEvidence;
  submitNotes: string;
  evaluatorNotes?: string;
};

export type CandidateEvaluationResult = {
  submissionId: string;
  sessionId: string;
  assessmentId: string;
  status: CandidateSubmissionStatus;
  submittedAt: string;
  completedAt?: string;
  submitNotes: string;
  workspaceSnapshotPath?: string;
  git?: CandidateSubmissionGitEvidence;
  hiddenTestResult?: SubmissionHiddenTestResult;
  dimensionScores?: CandidateEvaluationDimensionScore[];
  overallScore?: number;
  finalVerdict?: CandidateFinalVerdict;
  evaluatorNotes?: string;
  calculationDetails?: CandidateEvaluationCalculationDetails;
  workspaceStopRequestedAt?: string;
  errorText?: string;
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
  orchestration?: AssessmentOrchestrationEvidence;
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
  orchestration?: AssessmentOrchestrationEvidence;
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
  orchestration?: AssessmentOrchestrationEvidence;
};

export type GenerateAssessmentSuccess = {
  status: "success";
  assessmentId: string;
  assessmentName: string;
  candidateLaunchUrl: string;
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
  orchestration?: AssessmentOrchestrationEvidence;
};
