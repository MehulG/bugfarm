import { randomBytes } from "node:crypto";
import type {
  GenerateAssessmentSuccess,
  GenerateBugSuccess,
  GenerateTestsSuccess,
} from "../assessment/types.js";
import type { SeedBugSuccess } from "../bugfarm/types.js";
import type { JobAcceptedResponse, JobOperation, JobState } from "./types.js";

type JobResult =
  | SeedBugSuccess
  | GenerateBugSuccess
  | GenerateTestsSuccess
  | GenerateAssessmentSuccess;

class InMemoryJobStore {
  private readonly jobs = new Map<string, JobState>();

  createJob(input: {
    operation: JobOperation;
    runner: () => Promise<JobResult>;
  }): JobAcceptedResponse {
    const jobId = randomBytes(8).toString("hex");
    const now = new Date().toISOString();
    const pollUrl = `/jobs/${jobId}`;

    const job: JobState = {
      jobId,
      operation: input.operation,
      status: "queued",
      createdAt: now,
      pollUrl,
    };

    this.jobs.set(jobId, job);

    queueMicrotask(() => {
      void this.runJob(jobId, input.runner);
    });

    return {
      status: "accepted",
      jobId,
      operation: input.operation,
      pollUrl,
    };
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  private async runJob(jobId: string, runner: () => Promise<JobResult>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = "running";
    job.startedAt = new Date().toISOString();

    try {
      job.result = await runner();
      job.status = "succeeded";
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = {
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const jobStore = new InMemoryJobStore();
