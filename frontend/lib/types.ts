export type AssignmentDifficulty = "easy" | "medium" | "hard";

export type CandidateListRow = {
  candidateId: string;
  name: string;
  designation: string;
  githubRepo?: string;
  assignmentGenerated: boolean;
  assignmentSubmitted: boolean;
  assignmentStatus?: AssignmentStatus;
  assignmentRecordId?: string;
  assessmentId?: string;
  submissionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CandidateProfile = {
  candidateId: string;
  companyId: string;
  name: string;
  designation: string;
  githubRepo?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssignmentStatus = "queued" | "running" | "succeeded" | "failed";

export type AssignmentRecord = {
  assignmentRecordId: string;
  candidateId: string;
  companyId: string;
  generationJobId?: string;
  status: AssignmentStatus;
  repoPath: string;
  difficulty: string;
  area?: string;
  language?: string;
  bugCount: number;
  role?: string;
  assessmentName?: string;
  assessmentId?: string;
  candidateLaunchUrl?: string;
  artifactPath?: string;
  candidateRepoPath?: string;
  baselineRepoPath?: string;
  hiddenTestsPath?: string;
  bugReportPath?: string;
  taskPath?: string;
  patchPath?: string;
  summary?: string;
  filesChanged: string[];
  errorText?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  evidence?: {
    patchText?: string;
    patchTextTruncated: boolean;
    bugReportText?: string;
    bugReportTextTruncated: boolean;
    sourceCommit?: string;
  };
};

export type CandidateSubmission = {
  submissionId: string;
  sessionId: string;
  assessmentId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  submittedAt: string;
  completedAt?: string;
  submitNotes: string;
  git?: {
    branch: string;
    baselineCommit: string;
    submittedCommit: string;
    changedFiles: string[];
  };
  hiddenTestResult?: {
    status: "passed" | "failed";
    controlPassed: number;
    controlTotal: number;
    exposingPassed: number;
    exposingTotal: number;
    score: number;
  };
  dimensionScores?: Array<{
    name: string;
    weight: number;
    score: number;
    reason: string;
  }>;
  overallScore?: number;
  finalVerdict?: "pass" | "fail";
  evaluatorNotes?: string;
  calculationDetails?: {
    scoreFormula: string;
    aiUsageSummary: {
      requestCount: number;
      estimatedPromptTokens: number;
      estimatedCompletionTokens: number;
      estimatedTotalTokens: number;
    };
    evaluatorNotes?: string;
  };
};

export type CandidateDetailResponse = {
  candidate: CandidateProfile;
  currentAssignment?: AssignmentRecord;
  assignmentHistory: AssignmentRecord[];
  latestSubmission?: CandidateSubmission;
};

export type GenerateAssignmentInput = {
  difficulty: AssignmentDifficulty;
  repoPath: string;
  area?: string;
  language?: string;
  bugCount: number;
};
