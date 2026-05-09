import type {
  CandidateEvaluationAiProxyRequest,
  CandidateEvaluationAiUsageSummary,
  CandidateEvaluationCalculationDetails,
  CandidateEvaluationDimensionScore,
  CandidateEvaluationResult,
} from "../assessment/types.js";
import type { StoredAiProxyRequest } from "./store.js";

type EvaluationDetailStore = {
  listAiProxyRequests(input: { sessionId: string; limit?: number }): Promise<StoredAiProxyRequest[]>;
};

export async function attachCalculationDetails(
  result: CandidateEvaluationResult,
  store: EvaluationDetailStore,
): Promise<CandidateEvaluationResult> {
  const aiProxyRequests = await store.listAiProxyRequests({
    sessionId: result.sessionId,
  });
  const sanitizedRequests = aiProxyRequests.map(toDetailedAiProxyRequest);

  return {
    ...result,
    calculationDetails: buildCalculationDetails(result, sanitizedRequests),
  };
}

export async function attachCalculationDetailsToMany(
  results: CandidateEvaluationResult[],
  store: EvaluationDetailStore,
): Promise<CandidateEvaluationResult[]> {
  return Promise.all(results.map((result) => attachCalculationDetails(result, store)));
}

export function buildCalculationDetails(
  result: CandidateEvaluationResult,
  aiProxyRequests: CandidateEvaluationAiProxyRequest[],
): CandidateEvaluationCalculationDetails {
  return {
    scoreFormula: buildScoreFormula(result.dimensionScores),
    weightedScoreInputs: buildWeightedScoreInputs(result.dimensionScores),
    hiddenTestResult: result.hiddenTestResult,
    dimensionScores: result.dimensionScores,
    aiUsageSummary: summarizeAiUsage(aiProxyRequests),
    aiProxyRequests,
    submitNotes: result.submitNotes,
    evaluatorNotes: result.evaluatorNotes,
  };
}

function toDetailedAiProxyRequest(record: StoredAiProxyRequest): CandidateEvaluationAiProxyRequest {
  const sanitizedRequestJson = sanitizeText(record.requestJson);
  const sanitizedResponseBody = record.responseBody ? sanitizeText(record.responseBody) : undefined;
  const sanitizedErrorText = record.errorText ? sanitizeText(record.errorText) : undefined;
  const estimatedPromptTokens = estimateRequestTokens(sanitizedRequestJson);
  const estimatedCompletionTokens = estimateTokens(sanitizedResponseBody || "");

  return {
    createdAt: record.createdAt,
    model: record.model,
    requestJson: sanitizedRequestJson,
    responseBody: sanitizedResponseBody,
    status: record.status,
    providerStatus: record.providerStatus,
    errorText: sanitizedErrorText,
    estimatedPromptTokens,
    estimatedCompletionTokens,
    estimatedTotalTokens: estimatedPromptTokens + estimatedCompletionTokens,
  };
}

function buildScoreFormula(dimensionScores: CandidateEvaluationDimensionScore[] | undefined): string {
  const totalWeight = dimensionScores?.reduce((sum, dimension) => sum + dimension.weight, 0) || 0;
  if (!dimensionScores || dimensionScores.length === 0 || totalWeight === 0) {
    return "overallScore is unavailable because no dimension scores were stored.";
  }

  const weightedTerms = dimensionScores
    .map((dimension) => `${dimension.weight}*${dimension.name}`)
    .join(" + ");
  return `overallScore = (${weightedTerms}) / ${totalWeight}`;
}

function buildWeightedScoreInputs(
  dimensionScores: CandidateEvaluationDimensionScore[] | undefined,
): CandidateEvaluationCalculationDetails["weightedScoreInputs"] {
  const totalWeight = dimensionScores?.reduce((sum, dimension) => sum + dimension.weight, 0) || 0;
  if (!dimensionScores || totalWeight === 0) {
    return [];
  }

  return dimensionScores.map((dimension) => ({
    name: dimension.name,
    weight: dimension.weight,
    score: dimension.score,
    weightedContribution: roundScore((dimension.score * dimension.weight) / totalWeight),
    reason: dimension.reason,
  }));
}

function summarizeAiUsage(
  aiProxyRequests: CandidateEvaluationAiProxyRequest[],
): CandidateEvaluationAiUsageSummary {
  const first = aiProxyRequests[0];
  const last = aiProxyRequests[aiProxyRequests.length - 1];

  return {
    requestCount: aiProxyRequests.length,
    successfulRequestCount: aiProxyRequests.filter((request) => request.status === "succeeded").length,
    failedRequestCount: aiProxyRequests.filter((request) => request.status === "failed").length,
    estimatedPromptTokens: aiProxyRequests.reduce((sum, request) => sum + request.estimatedPromptTokens, 0),
    estimatedCompletionTokens: aiProxyRequests.reduce((sum, request) => sum + request.estimatedCompletionTokens, 0),
    estimatedTotalTokens: aiProxyRequests.reduce((sum, request) => sum + request.estimatedTotalTokens, 0),
    firstAiCallAt: first?.createdAt,
    lastAiCallAt: last?.createdAt,
  };
}

function estimateRequestTokens(requestJson: string): number {
  try {
    const parsed = JSON.parse(requestJson) as { messages?: Array<{ content?: unknown }> };
    if (Array.isArray(parsed.messages)) {
      return estimateTokens(parsed.messages.map((message) => stringifyContent(message.content)).join("\n"));
    }
  } catch {
    // Fall back to whole-body token estimation.
  }

  return estimateTokens(requestJson);
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return content === undefined ? "" : JSON.stringify(content);
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function sanitizeText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^"',\s}\\]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[REDACTED_TOKEN]");
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
