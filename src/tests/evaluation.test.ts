import test from "node:test";
import assert from "node:assert/strict";
import { CandidateSessionStore } from "../candidate/store.js";
import { hashToken } from "../candidate/tokens.js";
import { queueCandidateSubmission, computeOverallScore } from "../candidate/evaluation.js";
import { attachCalculationDetails } from "../candidate/evaluationDetails.js";
import { CandidateGitPreflightError } from "../candidate/gitSubmission.js";
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
    gitPreflight: async () => {},
  });
  const second = await queueCandidateSubmission({
    record: {
      ...(await store.findByLaunchToken(created.launchToken))!,
      coderWorkspaceId: "workspace-id",
    },
    notes: "Changed my mind.",
    store,
    coder: fakeCoder,
    gitPreflight: async () => {},
  });

  assert.equal(first.submissionId, second.submissionId);
  assert.equal(second.submitNotes, "Investigated and fixed it.");
});

test("queueCandidateSubmission blocks before creating a submission when Git preflight fails", async () => {
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

  const record = (await store.findByLaunchToken(created.launchToken))!;
  await assert.rejects(
    queueCandidateSubmission({
      record,
      notes: "Done.",
      store,
      coder: { async stopWorkspace() {} },
      gitPreflight: async () => {
        throw new CandidateGitPreflightError("Please commit your work to the main branch before submitting.");
      },
    }),
    CandidateGitPreflightError,
  );

  assert.equal(await store.findSubmissionBySessionId(record.sessionId), undefined);
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

test("calculation details expose scoring inputs and sanitized AI evidence", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
  });
  await store.createSubmission({
    submissionId: "submission-1",
    sessionId: created.record.sessionId,
    assessmentId: created.record.assessmentId,
    submitNotes: "Fixed the issue and verified it.",
  });
  await store.markSubmissionRunning({
    sessionId: created.record.sessionId,
    workspaceSnapshotPath: "/tmp/submission",
    git: {
      branch: "main",
      baselineCommit: "a".repeat(40),
      submittedCommit: "b".repeat(40),
      changedFiles: ["src/app.ts"],
    },
  });
  await store.markSubmissionSucceeded({
    sessionId: created.record.sessionId,
    hiddenTestResult: {
      status: "passed",
      ecosystem: "node",
      wrapperEntrypoints: ["hidden-tests/wrapper.js"],
      notes: ["Compared against baseline."],
      cases: [
        { caseId: "control-1", category: "control", matchedBaseline: true },
        { caseId: "bug-1", category: "exposes_bug", matchedBaseline: true },
      ],
      controlPassed: 1,
      controlTotal: 1,
      exposingPassed: 1,
      exposingTotal: 1,
      score: 100,
      reason: "All cases passed.",
    },
    dimensionScores: [
      { name: "correctness", weight: 35, score: 100, reason: "Hidden tests passed." },
      { name: "code_quality", weight: 25, score: 80, reason: "Readable implementation." },
    ],
    overallScore: 91.67,
    finalVerdict: "pass",
    evaluatorNotes: "Final verdict: pass",
  });
  await store.recordAiProxyRequest({
    sessionId: created.record.sessionId,
    assessmentId: created.record.assessmentId,
    model: "gpt-test",
    requestJson: JSON.stringify({
      model: "gpt-test",
      apiKey: "sk-secret1234567890",
      messages: [{ role: "user", content: "help debug this" }],
    }),
    responseBody: JSON.stringify({ choices: [{ message: { content: "try the parser" } }] }),
    status: "succeeded",
    providerStatus: 200,
  });

  const submission = await store.findSubmissionBySessionId(created.record.sessionId);
  assert(submission);
  const detailed = await attachCalculationDetails(submission, store);

  assert(detailed.calculationDetails);
  assert.match(detailed.calculationDetails.scoreFormula, /correctness/);
  assert.deepEqual(
    detailed.calculationDetails.weightedScoreInputs.map((input) => input.weightedContribution),
    [58.33, 33.33],
  );
  assert.equal(detailed.calculationDetails.aiUsageSummary.requestCount, 1);
  assert.equal(detailed.calculationDetails.aiUsageSummary.successfulRequestCount, 1);
  assert.equal(detailed.calculationDetails.aiProxyRequests.length, 1);
  assert.match(detailed.calculationDetails.aiProxyRequests[0].requestJson, /\[REDACTED/);
  assert.doesNotMatch(detailed.calculationDetails.aiProxyRequests[0].requestJson, /sk-secret/);
  assert.equal(detailed.calculationDetails.hiddenTestResult?.score, 100);
  assert.deepEqual(detailed.calculationDetails.git?.changedFiles, ["src/app.ts"]);
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
