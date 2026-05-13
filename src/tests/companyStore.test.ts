import test from "node:test";
import assert from "node:assert/strict";
import { CompanyStore } from "../company/store.js";
import type { GenerateAssessmentSuccess } from "../assessment/types.js";

test("company store creates candidates and exposes table rows", async () => {
  const store = new CompanyStore(":memory:");
  const candidate = await store.createCandidate({
    name: "Ada Lovelace",
    designation: "Backend Engineer",
    githubRepo: "github.com/acme/api",
  });

  const rows = await store.listCandidates();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].candidateId, candidate.candidateId);
  assert.equal(rows[0].name, "Ada Lovelace");
  assert.equal(rows[0].designation, "Backend Engineer");
  assert.equal(rows[0].githubRepo, "github.com/acme/api");
  assert.equal(rows[0].assignmentGenerated, false);
  assert.equal(rows[0].assignmentSubmitted, false);
});

test("company store keeps assignment history and resolves newest as current", async () => {
  const store = new CompanyStore(":memory:");
  const candidate = await store.createCandidate({
    name: "Grace Hopper",
    designation: "Infrastructure Engineer",
  });

  const first = await store.createAssignment({
    candidate,
    request: {
      repoPath: "github.com/acme/first",
      difficulty: "medium",
      role: candidate.designation,
      assessmentName: "First Assignment",
    },
  });
  const second = await store.createAssignment({
    candidate,
    request: {
      repoPath: "github.com/acme/second",
      difficulty: "hard",
      role: candidate.designation,
      assessmentName: "Second Assignment",
    },
  });

  await store.setAssignmentJobId({ assignmentRecordId: second.assignmentRecordId, generationJobId: "job-2" });
  await store.markAssignmentRunning({ assignmentRecordId: second.assignmentRecordId });
  await store.markAssignmentSucceeded({
    assignmentRecordId: second.assignmentRecordId,
    result: fakeAssessmentSuccess({ assessmentId: "assessment-2", repoPath: "github.com/acme/second" }),
  });

  const assignments = await store.listAssignmentsForCandidate({ candidateId: candidate.candidateId });
  const rows = await store.listCandidates();

  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].assignmentRecordId, second.assignmentRecordId);
  assert.equal(assignments[1].assignmentRecordId, first.assignmentRecordId);
  assert.equal(rows[0].assignmentGenerated, true);
  assert.equal(rows[0].assignmentStatus, "succeeded");
  assert.equal(rows[0].assessmentId, "assessment-2");
});

test("company store persists failed assignment state", async () => {
  const store = new CompanyStore(":memory:");
  const candidate = await store.createCandidate({
    name: "Katherine Johnson",
    designation: "Full Stack Engineer",
  });
  const assignment = await store.createAssignment({
    candidate,
    request: {
      repoPath: "github.com/acme/app",
      difficulty: "easy",
      role: candidate.designation,
      assessmentName: "App Assignment",
    },
  });

  await store.markAssignmentRunning({ assignmentRecordId: assignment.assignmentRecordId });
  await store.markAssignmentFailed({
    assignmentRecordId: assignment.assignmentRecordId,
    errorText: "No assignment candidate survived validation",
  });

  const fetched = await store.findAssignment({ assignmentRecordId: assignment.assignmentRecordId });
  assert(fetched);
  assert.equal(fetched.status, "failed");
  assert.equal(fetched.errorText, "No assignment candidate survived validation");
  assert.equal(typeof fetched.completedAt, "string");
});

function fakeAssessmentSuccess(input: {
  assessmentId: string;
  repoPath: string;
}): GenerateAssessmentSuccess {
  return {
    status: "success",
    assessmentId: input.assessmentId,
    assessmentName: "Generated Assignment",
    candidateLaunchUrl: `https://backend.example.com/candidate/launch/${input.assessmentId}`,
    artifactPath: "/tmp/artifact",
    candidateRepoPath: "/tmp/artifact/candidate-repo",
    baselineRepoPath: "/tmp/artifact/baseline-repo",
    hiddenTestsPath: "/tmp/artifact/hidden-tests",
    validation: {
      status: "passed",
      ecosystem: "node",
      hiddenTestsPath: "/tmp/artifact/hidden-tests",
      retryCount: 0,
      wrapperEntrypoints: ["hidden-tests/wrapper.js"],
      targetSymbols: [],
      baseline: { target: "baseline", status: "passed" },
      candidate: { target: "candidate", status: "passed" },
      notes: [],
    },
    filesChanged: ["src/app.ts"],
    summary: `Generated from ${input.repoPath}`,
    difficulty: "medium",
    bugCount: 1,
    bugReportPath: "/tmp/artifact/reports/BUG_REPORT.md",
    taskPath: "/tmp/artifact/candidate/TASK.md",
    patchPath: "/tmp/artifact/patches/bug.patch",
    rubricPath: "/tmp/artifact/rubric.json",
  };
}
