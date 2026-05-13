import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "../server.js";
import { CompanyStore } from "../company/store.js";
import { CandidateSessionStore } from "../candidate/store.js";
import type { GenerateAssessmentRequest, GenerateAssessmentSuccess } from "../assessment/types.js";

const execFileAsync = promisify(execFile);

test("company routes create candidates, queue generation, and return evidence", async () => {
  const dbPath = path.join(await mkdtemp(path.join(tmpdir(), "codesheep-company-db-")), "test.sqlite");
  const artifactPath = await createFakeArtifact();
  const companyStore = new CompanyStore(dbPath);
  const candidateStore = new CandidateSessionStore(dbPath, "https://backend.example.com");
  const generatedRequests: GenerateAssessmentRequest[] = [];
  const app = createServer({
    company: {
      companyStore,
      candidateStore,
      generateAssessment: async (request) => {
        generatedRequests.push(request);
        return fakeAssessmentSuccess({ artifactPath, request });
      },
    },
  });
  const server = await listen(app);

  try {
    const baseUrl = baseServerUrl(server);
    const createResponse = await fetch(`${baseUrl}/api/company/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Maya Iyer",
        designation: "Backend Engineer",
        githubRepo: "github.com/acme/api",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      candidate: { candidateId: string };
    };

    const assignmentResponse = await fetch(
      `${baseUrl}/api/company/candidates/${created.candidate.candidateId}/assignments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: "github.com/acme/api",
          difficulty: "medium",
          area: "auth",
          bugCount: 1,
        }),
      },
    );
    assert.equal(assignmentResponse.status, 202);
    const accepted = (await assignmentResponse.json()) as {
      jobId: string;
      assignmentRecordId: string;
    };
    assert.equal(typeof accepted.assignmentRecordId, "string");

    await waitForAssignment(baseUrl, created.candidate.candidateId, accepted.assignmentRecordId);

    const listResponse = await fetch(`${baseUrl}/api/company/candidates`);
    assert.equal(listResponse.status, 200);
    const listed = (await listResponse.json()) as {
      candidates: Array<{
        assignmentGenerated: boolean;
        assignmentSubmitted: boolean;
        assessmentId?: string;
      }>;
    };
    assert.equal(listed.candidates.length, 1);
    assert.equal(listed.candidates[0].assignmentGenerated, true);
    assert.equal(listed.candidates[0].assignmentSubmitted, false);
    assert.equal(listed.candidates[0].assessmentId, "assessment-route-test");

    const detailResponse = await fetch(`${baseUrl}/api/company/candidates/${created.candidate.candidateId}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      currentAssignment: {
        summary: string;
        evidence: {
          patchText?: string;
          bugReportText?: string;
          sourceCommit?: string;
        };
      };
    };
    assert.match(detail.currentAssignment.summary, /Generated route test/);
    assert.match(detail.currentAssignment.evidence.patchText ?? "", /diff --git/);
    assert.match(detail.currentAssignment.evidence.bugReportText ?? "", /Root cause/);
    assert.match(detail.currentAssignment.evidence.sourceCommit ?? "", /^[a-f0-9]{40}$/);
    assert.equal(generatedRequests[0].role, "Backend Engineer");
    assert.match(generatedRequests[0].assessmentName ?? "", /Maya Iyer Backend Engineer/);
  } finally {
    await close(server);
  }
});

test("company routes validate create candidate and assignment requests", async () => {
  const dbPath = path.join(await mkdtemp(path.join(tmpdir(), "codesheep-company-db-")), "test.sqlite");
  const app = createServer({
    company: {
      companyStore: new CompanyStore(dbPath),
      candidateStore: new CandidateSessionStore(dbPath, "https://backend.example.com"),
      generateAssessment: async () => {
        throw new Error("should not run");
      },
    },
  });
  const server = await listen(app);

  try {
    const baseUrl = baseServerUrl(server);
    const invalidCreate = await fetch(`${baseUrl}/api/company/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(invalidCreate.status, 400);

    const created = await fetch(`${baseUrl}/api/company/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada", designation: "Engineer" }),
    });
    const body = (await created.json()) as { candidate: { candidateId: string } };

    const invalidAssignment = await fetch(
      `${baseUrl}/api/company/candidates/${body.candidate.candidateId}/assignments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: "github.com/acme/api", difficulty: "extreme" }),
      },
    );
    assert.equal(invalidAssignment.status, 400);
  } finally {
    await close(server);
  }
});

async function createFakeArtifact(): Promise<string> {
  const artifactPath = await mkdtemp(path.join(tmpdir(), "codesheep-artifact-"));
  const baselineRepoPath = path.join(artifactPath, "baseline-repo");
  await mkdir(path.join(artifactPath, "patches"), { recursive: true });
  await mkdir(path.join(artifactPath, "reports"), { recursive: true });
  await mkdir(baselineRepoPath, { recursive: true });
  await execFileAsync("git", ["init", baselineRepoPath]);
  await execFileAsync("git", ["-C", baselineRepoPath, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", baselineRepoPath, "config", "user.name", "Test User"]);
  await writeFile(path.join(baselineRepoPath, "README.md"), "baseline\n", "utf8");
  await execFileAsync("git", ["-C", baselineRepoPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", baselineRepoPath, "commit", "-m", "Initial commit"]);
  await writeFile(
    path.join(artifactPath, "patches", "bug.patch"),
    "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n",
    "utf8",
  );
  await writeFile(path.join(artifactPath, "reports", "BUG_REPORT.md"), "# Root cause\n\nSeeded bug.\n", "utf8");
  return artifactPath;
}

function fakeAssessmentSuccess(input: {
  artifactPath: string;
  request: GenerateAssessmentRequest;
}): GenerateAssessmentSuccess {
  return {
    status: "success",
    assessmentId: "assessment-route-test",
    assessmentName: input.request.assessmentName ?? "Route Test",
    candidateLaunchUrl: "https://backend.example.com/candidate/launch/token",
    artifactPath: input.artifactPath,
    candidateRepoPath: path.join(input.artifactPath, "candidate-repo"),
    baselineRepoPath: path.join(input.artifactPath, "baseline-repo"),
    hiddenTestsPath: path.join(input.artifactPath, "hidden-tests"),
    validation: {
      status: "passed",
      ecosystem: "node",
      hiddenTestsPath: path.join(input.artifactPath, "hidden-tests"),
      retryCount: 0,
      wrapperEntrypoints: ["hidden-tests/wrapper.js"],
      targetSymbols: [],
      baseline: { target: "baseline", status: "passed" },
      candidate: { target: "candidate", status: "passed" },
      notes: [],
    },
    filesChanged: ["src/app.ts"],
    summary: "Generated route test assignment",
    difficulty: input.request.difficulty ?? "medium",
    bugCount: input.request.bugCount ?? 1,
    bugReportPath: path.join(input.artifactPath, "reports", "BUG_REPORT.md"),
    taskPath: path.join(input.artifactPath, "candidate", "TASK.md"),
    patchPath: path.join(input.artifactPath, "patches", "bug.patch"),
    rubricPath: path.join(input.artifactPath, "rubric.json"),
  };
}

function listen(app: ReturnType<typeof createServer>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function baseServerUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitForAssignment(
  baseUrl: string,
  candidateId: string,
  assignmentRecordId: string,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${baseUrl}/api/company/candidates/${candidateId}/assignments/${assignmentRecordId}/job`,
    );
    const body = (await response.json()) as {
      assignment: { status: string };
    };
    if (body.assignment.status === "succeeded" || body.assignment.status === "failed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for assignment generation");
}
