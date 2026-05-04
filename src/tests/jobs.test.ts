import test from "node:test";
import assert from "node:assert/strict";
import { jobStore } from "../jobs/store.js";

test("jobStore runs successful jobs to completion", async () => {
  const accepted = jobStore.createJob({
    operation: "seed-bug",
    runner: async () => ({
      status: "success",
      requestedRepoPath: "/tmp/repo",
      repoPath: "/tmp/repo",
      repoSource: "local",
      summary: "done",
      difficulty: "medium",
      bugCount: 1,
      filesChanged: ["src/auth.ts"],
      bugReportPath: "/tmp/repo/BUG_REPORT.md",
    }),
  });

  assert.equal(accepted.status, "accepted");

  await waitForTerminalState(accepted.jobId);

  const job = jobStore.getJob(accepted.jobId);
  assert(job);
  assert.equal(job.status, "succeeded");
  assert.equal(job.operation, "seed-bug");
  assert.equal(job.result?.status, "success");
  assert.equal(job.error, undefined);
});

test("jobStore records failed jobs", async () => {
  const accepted = jobStore.createJob({
    operation: "generate-assessment",
    runner: async () => {
      throw new Error("boom");
    },
  });

  await waitForTerminalState(accepted.jobId);

  const job = jobStore.getJob(accepted.jobId);
  assert(job);
  assert.equal(job.status, "failed");
  assert.equal(job.operation, "generate-assessment");
  assert.equal(job.error?.message, "boom");
  assert.equal(job.result, undefined);
});

async function waitForTerminalState(jobId: string): Promise<void> {
  const timeoutAt = Date.now() + 2000;

  while (Date.now() < timeoutAt) {
    const job = jobStore.getJob(jobId);
    if (job && (job.status === "succeeded" || job.status === "failed")) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Timed out waiting for job ${jobId}`);
}
