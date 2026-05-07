import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getChangedFiles } from "../codesheep/git.js";
import { runCursorAgent } from "../cursor/client.js";
import { evaluateSubmittedRepoAgainstHiddenTests } from "../assessment/hiddenTests.js";
import { loadAssessmentMetadata } from "../assessment/generateTests.js";
import type {
  CandidateEvaluationDimensionScore,
  CandidateEvaluationResult,
  CandidateFinalVerdict,
} from "../assessment/types.js";
import { candidateSessionStore, type CandidateSessionRecord } from "./store.js";
import { CoderClient } from "./coderClient.js";

const execFileAsync = promisify(execFile);
const runningEvaluations = new Map<string, Promise<void>>();

type EvaluationStore = Pick<
  typeof candidateSessionStore,
  | "createSubmission"
  | "findSubmissionBySessionId"
  | "markSubmissionRunning"
  | "markSubmissionSucceeded"
  | "markSubmissionFailed"
  | "markWorkspaceStopRequested"
  | "getLatestAiProxyRequest"
>;

type EvaluationCoder = Pick<CoderClient, "stopWorkspace">;

export async function queueCandidateSubmission(input: {
  record: CandidateSessionRecord;
  notes: string;
  store?: EvaluationStore;
  coder?: EvaluationCoder;
}): Promise<CandidateEvaluationResult> {
  const store = input.store ?? candidateSessionStore;
  const existing = await store.findSubmissionBySessionId(input.record.sessionId);
  if (existing) {
    return existing;
  }

  let submission: CandidateEvaluationResult;
  try {
    submission = await store.createSubmission({
      submissionId: `${input.record.sessionId}-${Date.now().toString(36)}`,
      sessionId: input.record.sessionId,
      assessmentId: input.record.assessmentId,
      submitNotes: input.notes.trim(),
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      const duplicate = await store.findSubmissionBySessionId(input.record.sessionId);
      if (duplicate) {
        return duplicate;
      }
    }
    throw error;
  }

  const evaluationPromise = evaluateCandidateSubmission({
    record: input.record,
    store,
    coder: input.coder ?? new CoderClient(),
  }).finally(() => {
    runningEvaluations.delete(input.record.sessionId);
  });
  runningEvaluations.set(input.record.sessionId, evaluationPromise);
  void evaluationPromise;

  return submission;
}

async function evaluateCandidateSubmission(input: {
  record: CandidateSessionRecord;
  store: EvaluationStore;
  coder: EvaluationCoder;
}): Promise<void> {
  const submission = await input.store.findSubmissionBySessionId(input.record.sessionId);
  if (!submission) {
    throw new Error("Submission record was not created");
  }

  const snapshotRoot = path.join(input.record.artifactPath, "submissions", submission.submissionId);
  const snapshotPath = path.join(snapshotRoot, "project");
  try {
    await mkdir(snapshotPath, { recursive: true });
    await snapshotWorkspaceRepo(input.record, snapshotPath);
    await input.store.markSubmissionRunning({
      sessionId: input.record.sessionId,
      workspaceSnapshotPath: snapshotPath,
    });

    const metadata = await loadAssessmentMetadata(input.record.artifactPath);
    const hiddenTestResult = await evaluateSubmittedRepoAgainstHiddenTests({
      artifactPath: metadata.artifactPath,
      baselineRepoPath: metadata.baselineRepoPath,
      submittedRepoPath: snapshotPath,
      hiddenTestsPath: metadata.hiddenTestsPath,
    });
    const latestAiRequest = await input.store.getLatestAiProxyRequest(input.record.sessionId);
    const dimensionScores = await scoreDimensions({
      metadata,
      snapshotPath,
      submitNotes: submission.submitNotes,
      hiddenTestResult,
      latestAiRequestText: latestAiRequest?.requestJson,
    });
    const overallScore = computeOverallScore(dimensionScores);
    const finalVerdict: CandidateFinalVerdict =
      hiddenTestResult.score >= 70 && overallScore >= 70 ? "pass" : "fail";
    const evaluatorNotes = buildEvaluatorNotes(hiddenTestResult, dimensionScores, finalVerdict);

    await input.store.markSubmissionSucceeded({
      sessionId: input.record.sessionId,
      hiddenTestResult,
      dimensionScores,
      overallScore,
      finalVerdict,
      evaluatorNotes,
    });

    try {
      await input.coder.stopWorkspace(input.record.coderWorkspaceId!);
      await input.store.markWorkspaceStopRequested(input.record.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stop workspace";
      await input.store.markSubmissionSucceeded({
        sessionId: input.record.sessionId,
        hiddenTestResult,
        dimensionScores,
        overallScore,
        finalVerdict,
        evaluatorNotes: `${evaluatorNotes}\nWorkspace stop request failed: ${message}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evaluation failed";
    await input.store.markSubmissionFailed({
      sessionId: input.record.sessionId,
      errorText: message,
      workspaceSnapshotPath: snapshotPath,
    });
  }
}

async function snapshotWorkspaceRepo(record: CandidateSessionRecord, destinationPath: string): Promise<void> {
  if (!record.coderUsername || !record.coderWorkspaceName) {
    throw new Error("Candidate workspace metadata is incomplete");
  }

  const containerName = `coder-${record.coderUsername}-${record.coderWorkspaceName.toLowerCase()}`;
  await execFileAsync("docker", ["cp", `${containerName}:/home/coder/project/.`, destinationPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function scoreDimensions(input: {
  metadata: Awaited<ReturnType<typeof loadAssessmentMetadata>>;
  snapshotPath: string;
  submitNotes: string;
  hiddenTestResult: CandidateEvaluationResult["hiddenTestResult"];
  latestAiRequestText?: string;
}): Promise<CandidateEvaluationDimensionScore[]> {
  const changedFiles = await getChangedFiles(input.snapshotPath);
  const expectedFiles = new Set(input.metadata.filesChanged);
  const unrelatedFiles = changedFiles.filter((file) => !expectedFiles.has(file));
  const touchedExpected = changedFiles.filter((file) => expectedFiles.has(file));
  const minimalityScore =
    changedFiles.length === 0
      ? 0
      : Math.max(0, Math.round((100 - unrelatedFiles.length * 20 - Math.max(0, changedFiles.length - touchedExpected.length) * 5) * 100) / 100);

  const qualityScores = await scoreWithCursor({
    repoPath: input.snapshotPath,
    prompt: buildQualityPrompt({
      metadata: input.metadata,
      changedFiles,
      submitNotes: input.submitNotes,
      latestAiRequestText: input.latestAiRequestText,
    }),
  });

  const aiDifficultyScore = deriveAiDifficultyScore(input.metadata.difficulty, input.metadata.bugCount);

  return input.metadata.rubric.dimensions.map((dimension) => {
    switch (dimension.name) {
      case "correctness":
        return {
          name: dimension.name,
          weight: dimension.weight,
          score: input.hiddenTestResult?.score ?? 0,
          reason: input.hiddenTestResult?.reason || "Hidden tests did not run successfully.",
        };
      case "minimality":
        return {
          name: dimension.name,
          weight: dimension.weight,
          score: clampScore(minimalityScore),
          reason:
            unrelatedFiles.length === 0
              ? "Changes stayed focused on the expected area."
              : `Unrelated file churn detected: ${unrelatedFiles.join(", ")}.`,
        };
      case "code_quality":
        return scoreFromCursorDimension(dimension.name, dimension.weight, qualityScores);
      case "test_coverage":
        return scoreFromCursorDimension(dimension.name, dimension.weight, qualityScores);
      case "debugging_process":
        return scoreFromCursorDimension(dimension.name, dimension.weight, qualityScores);
      case "ai_assistant_difficulty":
        return {
          name: dimension.name,
          weight: dimension.weight,
          score: aiDifficultyScore,
          reason: `Artifact difficulty=${input.metadata.difficulty}, bugCount=${input.metadata.bugCount}.`,
        };
      default:
        return {
          name: dimension.name,
          weight: dimension.weight,
          score: 0,
          reason: "No scoring rule configured for this dimension.",
        };
    }
  });
}

export function computeOverallScore(dimensionScores: CandidateEvaluationDimensionScore[]): number {
  const totalWeight = dimensionScores.reduce((sum, dimension) => sum + dimension.weight, 0) || 1;
  const weighted =
    dimensionScores.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) / totalWeight;
  return Math.round(weighted * 100) / 100;
}

function buildEvaluatorNotes(
  hiddenTestResult: CandidateEvaluationResult["hiddenTestResult"],
  dimensionScores: CandidateEvaluationDimensionScore[],
  finalVerdict: CandidateFinalVerdict,
): string {
  const topReasons = dimensionScores
    .map((dimension) => `${dimension.name}: ${dimension.score} (${dimension.reason})`)
    .join("\n");
  return `Final verdict: ${finalVerdict}\nHidden tests: ${hiddenTestResult?.status || "failed"} (${hiddenTestResult?.reason || "no reason"})\n${topReasons}`;
}

async function scoreWithCursor(input: {
  repoPath: string;
  prompt: string;
}): Promise<Record<string, { score: number; reason: string }>> {
  try {
    const output = await runCursorAgent({
      repoPath: input.repoPath,
      prompt: input.prompt,
    });
    const parsed = parseEvaluationJson(output);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fallback to heuristics below.
  }

  return {
    code_quality: { score: 70, reason: "Defaulted to neutral score because evaluator model output was unavailable." },
    test_coverage: { score: 40, reason: "Defaulted conservatively because evaluator model output was unavailable." },
    debugging_process: { score: 60, reason: "Defaulted to moderate score based on submitted notes only." },
  };
}

function buildQualityPrompt(input: {
  metadata: Awaited<ReturnType<typeof loadAssessmentMetadata>>;
  changedFiles: string[];
  submitNotes: string;
  latestAiRequestText?: string;
}): string {
  return `Evaluate the candidate submission for this debugging assessment.

Return only JSON with keys code_quality, test_coverage, debugging_process.
Each key must contain { "score": number, "reason": string } where score is 0-100.

Assessment summary: ${input.metadata.summary}
Difficulty: ${input.metadata.difficulty}
Bug count: ${input.metadata.bugCount}
Expected changed files: ${input.metadata.filesChanged.join(", ")}
Actual changed files: ${input.changedFiles.join(", ")}
Submit notes:
${input.submitNotes}

Latest AI request transcript excerpt:
${input.latestAiRequestText || "none"}
`;
}

function scoreFromCursorDimension(
  name: string,
  weight: number,
  scores: Record<string, { score: number; reason: string }>,
): CandidateEvaluationDimensionScore {
  const value = scores[name] || { score: 50, reason: "Evaluator returned no score." };
  return {
    name,
    weight,
    score: clampScore(value.score),
    reason: value.reason,
  };
}

function deriveAiDifficultyScore(difficulty: string, bugCount: number): number {
  const base =
    difficulty === "hard" ? 90
    : difficulty === "easy" ? 40
    : 70;
  return clampScore(base + Math.max(0, bugCount - 1) * 5);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

function parseEvaluationJson(output: string): Record<string, { score: number; reason: string }> | undefined {
  const stringsToInspect = collectEventStrings(output);
  for (const value of stringsToInspect.reverse()) {
    const parsed = parseJsonObjectFromText(value);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  }
  return parseJsonObjectFromText(output);
}

function collectEventStrings(output: string): string[] {
  const values: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    values.push(trimmed);
    try {
      const parsed = JSON.parse(trimmed) as { text?: string; content?: unknown; output?: string };
      if (typeof parsed.text === "string") {
        values.push(parsed.text);
      }
      if (typeof parsed.output === "string") {
        values.push(parsed.output);
      }
      if (typeof parsed.content === "string") {
        values.push(parsed.content);
      }
    } catch {
      // Ignore event parse errors.
    }
  }
  return values;
}

function parseJsonObjectFromText(text: string): Record<string, { score: number; reason: string }> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, { score: number; reason: string }>;
  } catch {
    return undefined;
  }
}
