import test from "node:test";
import assert from "node:assert/strict";
import { CandidateSessionStore } from "../candidate/store.js";
import { hashToken } from "../candidate/tokens.js";
import { queueCandidateSubmission, computeOverallScore } from "../candidate/evaluation.js";
import { summarizeSubmittedCaseResults } from "../assessment/hiddenTests.js";

test("candidate session store records submit token and submission lookup", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
  });

  await store.markProvisioned({
    sessionId: created.record.sessionId,
    artifactTokenHash: hashToken("artifact-token"),
    aiTokenHash: hashToken("ai-token"),
    submitTokenHash: hashToken("submit-token"),
    coderUserId: "user-id",
    coderUsername: "candidate-abc",
    coderWorkspaceId: "workspace-id",
    coderWorkspaceName: "assess-abc",
  });

  const submitRecord = await store.findSubmitSessionByToken("submit-token");
  assert(submitRecord);
  assert.equal(submitRecord.sessionId, created.record.sessionId);

  const queued = await store.createSubmission({
    submissionId: "submission-1",
    sessionId: created.record.sessionId,
    assessmentId: created.record.assessmentId,
    submitNotes: "Fixed the bug and ran the visible test suite.",
  });
  assert.equal(queued.status, "queued");

  const fetched = await store.findSubmissionBySessionId(created.record.sessionId);
  assert(fetched);
  assert.equal(fetched.submitNotes, "Fixed the bug and ran the visible test suite.");
});

test("candidate session store lists full submissions by assessment", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
  });

  await store.createSubmission({
    submissionId: "submission-1",
    sessionId: created.record.sessionId,
    assessmentId: created.record.assessmentId,
    submitNotes: "Fixed the bug.",
  });

  const submissions = await store.listSubmissions({ assessmentId: "assessment-123" });
  const byId = await store.findSubmissionBySubmissionId("submission-1");

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].submissionId, "submission-1");
  assert.equal(submissions[0].sessionId, created.record.sessionId);
  assert.equal(submissions[0].assessmentId, "assessment-123");
  assert.equal(submissions[0].status, "queued");
  assert.equal(submissions[0].submitNotes, "Fixed the bug.");
  assert.deepEqual(byId, submissions[0]);
  assert.deepEqual(await store.listSubmissions({ assessmentId: "missing" }), []);
});

test("queueCandidateSubmission is stable for repeat submits", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
  });

  await store.markProvisioned({
    sessionId: created.record.sessionId,
    artifactTokenHash: hashToken("artifact-token"),
    aiTokenHash: hashToken("ai-token"),
    submitTokenHash: hashToken("submit-token"),
    coderUserId: "user-id",
    coderUsername: "candidate-abc",
    coderWorkspaceId: "workspace-id",
    coderWorkspaceName: "assess-abc",
  });

  const fakeCoder = {
    async stopWorkspace() {},
  };
  const first = await queueCandidateSubmission({
    record: {
      ...(await store.findByLaunchToken(created.launchToken))!,
      coderWorkspaceId: "workspace-id",
    },
    notes: "Investigated and fixed it.",
    store,
    coder: fakeCoder,
  });
  const second = await queueCandidateSubmission({
    record: {
      ...(await store.findByLaunchToken(created.launchToken))!,
      coderWorkspaceId: "workspace-id",
    },
    notes: "Changed my mind.",
    store,
    coder: fakeCoder,
  });

  assert.equal(first.submissionId, second.submissionId);
  assert.equal(second.submitNotes, "Investigated and fixed it.");
});

test("computeOverallScore uses rubric weights", () => {
  const score = computeOverallScore([
    { name: "correctness", weight: 35, score: 80, reason: "" },
    { name: "minimality", weight: 15, score: 100, reason: "" },
    { name: "code_quality", weight: 15, score: 60, reason: "" },
    { name: "test_coverage", weight: 15, score: 40, reason: "" },
    { name: "debugging_process", weight: 10, score: 90, reason: "" },
    { name: "ai_assistant_difficulty", weight: 10, score: 70, reason: "" },
  ]);

  assert.equal(score, 74);
});

test("summarizeSubmittedCaseResults scores control and exposes_bug proportions separately", () => {
  const summary = summarizeSubmittedCaseResults([
    { caseId: "control-1", category: "control", matchedBaseline: true },
    { caseId: "control-2", category: "control", matchedBaseline: false },
    { caseId: "bug-1", category: "exposes_bug", matchedBaseline: true },
    { caseId: "bug-2", category: "exposes_bug", matchedBaseline: true },
  ]);

  assert.deepEqual(summary, {
    controlPassed: 1,
    controlTotal: 2,
    exposingPassed: 2,
    exposingTotal: 2,
    score: 75,
  });
});
