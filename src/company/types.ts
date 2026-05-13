import type {
  AssessmentValidation,
  CandidateEvaluationResult,
  GenerateAssessmentRequest,
  GenerateAssessmentSuccess,
} from "../assessment/types.js";
import type { JobState } from "../jobs/types.js";

export const DEFAULT_COMPANY_ID = "default";

export type CompanyCandidate = {
  candidateId: string;
  companyId: string;
  name: string;
  designation: string;
  githubRepo?: string;
  createdAt: string;
  updatedAt: string;
};

export type CompanyAssignmentStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type CompanyAssignmentRecord = {
  assignmentRecordId: string;
  candidateId: string;
  companyId: string;
  generationJobId?: string;
  status: CompanyAssignmentStatus;
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
  validation?: AssessmentValidation;
  orchestration?: GenerateAssessmentSuccess["orchestration"];
  errorText?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type CompanyCandidateListRow = {
  candidateId: string;
  name: string;
  designation: string;
  githubRepo?: string;
  assignmentGenerated: boolean;
  assignmentSubmitted: boolean;
  assignmentStatus?: CompanyAssignmentStatus;
  assignmentRecordId?: string;
  assessmentId?: string;
  submissionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssignmentEvidence = {
  patchText?: string;
  patchTextTruncated: boolean;
  bugReportText?: string;
  bugReportTextTruncated: boolean;
  sourceCommit?: string;
};

export type CompanyCandidateDetail = {
  candidate: CompanyCandidate;
  currentAssignment?: CompanyAssignmentRecord & {
    evidence?: AssignmentEvidence;
  };
  assignmentHistory: CompanyAssignmentRecord[];
  latestSubmission?: CandidateEvaluationResult;
};

export type CreateCompanyCandidateInput = {
  name: string;
  designation: string;
  githubRepo?: string;
};

export type CreateCompanyAssignmentInput = GenerateAssessmentRequest;

export type CompanyAssignmentJobStatus = {
  assignment: CompanyAssignmentRecord;
  job?: JobState;
};
