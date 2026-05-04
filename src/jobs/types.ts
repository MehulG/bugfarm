import type {
  GenerateAssessmentSuccess,
  GenerateBugSuccess,
  GenerateTestsSuccess,
} from "../assessment/types.js";
import type { SeedBugSuccess } from "../bugfarm/types.js";

export type JobOperation =
  | "seed-bug"
  | "generate-bug"
  | "generate-tests"
  | "generate-assessment";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobAcceptedResponse = {
  status: "accepted";
  jobId: string;
  operation: JobOperation;
  pollUrl: string;
};

export type JobFailure = {
  message: string;
};

export type JobState = {
  jobId: string;
  operation: JobOperation;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pollUrl: string;
  result?: SeedBugSuccess | GenerateBugSuccess | GenerateTestsSuccess | GenerateAssessmentSuccess;
  error?: JobFailure;
};
