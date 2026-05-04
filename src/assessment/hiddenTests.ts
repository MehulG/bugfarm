import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCursorAgent } from "../cursor/client.js";
import type { AssessmentValidation, AssessmentValidationRun } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_RETRIES = 3;

export type HiddenTestSpec = {
  ecosystem: "python" | "node";
  wrapper: {
    kind: "python" | "node";
    path: string;
  };
  cases: Array<{
    id: string;
    category: "control" | "exposes_bug";
    description: string;
    input: unknown;
  }>;
};

type HiddenTestGenerationJson = {
  ecosystem?: "python" | "node";
  wrapperPath?: string;
  caseCount?: number;
  targetSymbols?: string[];
};

type CaseExecution = {
  caseId: string;
  category: "control" | "exposes_bug";
  matchedBaseline?: boolean;
  output?: string;
  reason?: string;
};

export async function createAndValidateHiddenTests(input: {
  artifactPath: string;
  baselineRepoPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  bugReportPath: string;
  filesChanged: string[];
  language?: string;
}): Promise<AssessmentValidation> {
  const basePrompt = await loadPrompt();
  const bugReport = await readFile(input.bugReportPath, "utf8");
  const targetSymbols = extractTargetSymbols(bugReport, input.filesChanged);
  let lastValidation = skippedValidation(input.hiddenTestsPath, targetSymbols);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await resetHiddenTestsPath(input.hiddenTestsPath);

    const generated = await generateHiddenTestBundle({
      artifactPath: input.artifactPath,
      basePrompt,
      bugReport,
      filesChanged: input.filesChanged,
      language: input.language,
      targetSymbols,
      attempt,
    });

    const validation = await validateBundle({
      artifactPath: input.artifactPath,
      baselineRepoPath: input.baselineRepoPath,
      candidateRepoPath: input.candidateRepoPath,
      hiddenTestsPath: input.hiddenTestsPath,
      generated,
      targetSymbols,
      attempt,
    });

    if (validation.status === "passed") {
      return validation;
    }

    lastValidation = validation;
  }

  return {
    ...lastValidation,
    retryCount: MAX_RETRIES,
    rejectedReason:
      lastValidation.rejectedReason ||
      lastValidation.candidate.reason ||
      lastValidation.baseline.reason ||
      "Hidden test generation did not produce a valid deterministic assessment.",
  };
}

async function generateHiddenTestBundle(input: {
  artifactPath: string;
  basePrompt: string;
  bugReport: string;
  filesChanged: string[];
  language?: string;
  targetSymbols: string[];
  attempt: number;
}): Promise<{
  generation: HiddenTestGenerationJson;
  spec?: HiddenTestSpec;
}> {
  const prompt = `${input.basePrompt}

Attempt: ${input.attempt}
Preferred language/ecosystem: ${input.language || "infer from repo"}
Changed files:
${input.filesChanged.map((file) => `- ${file}`).join("\n")}

Target symbols:
${input.targetSymbols.length > 0 ? input.targetSymbols.map((symbol) => `- ${symbol}`).join("\n") : "- infer from bug report"}

Bug report:
\`\`\`markdown
${input.bugReport}
\`\`\`

The artifact root is your working directory. Inspect baseline-repo/ and candidate-repo/ as needed. Only write files inside hidden-tests/.`;

  const output = await runCursorAgent({
    repoPath: input.artifactPath,
    prompt,
  });

  const generation = parseGenerationJson(output) || {};
  const spec = await loadSpec(path.join(input.artifactPath, "hidden-tests", "spec.json"));

  return { generation, spec };
}

async function validateBundle(input: {
  artifactPath: string;
  baselineRepoPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  generated: {
    generation: HiddenTestGenerationJson;
    spec?: HiddenTestSpec;
  };
  targetSymbols: string[];
  attempt: number;
}): Promise<AssessmentValidation> {
  const { generation, spec } = input.generated;

  if (!spec) {
    return failedValidation({
      hiddenTestsPath: input.hiddenTestsPath,
      ecosystem: generation.ecosystem || "unknown",
      retryCount: input.attempt,
      wrapperEntrypoints: generation.wrapperPath ? [generation.wrapperPath] : [],
      targetSymbols: generation.targetSymbols || input.targetSymbols,
      baselineReason: "hidden-tests/spec.json was not created or could not be parsed.",
      candidateReason: "No executable hidden test spec was available.",
      rejectedReason: "Hidden test generation did not produce a valid spec.",
    });
  }

  const specError = validateSpec(spec);
  if (specError) {
    return failedValidation({
      hiddenTestsPath: input.hiddenTestsPath,
      ecosystem: spec.ecosystem,
      retryCount: input.attempt,
      wrapperEntrypoints: [spec.wrapper.path],
      targetSymbols: generation.targetSymbols || input.targetSymbols,
      baselineReason: specError,
      candidateReason: "Spec validation failed before execution.",
      rejectedReason: specError,
    });
  }

  const baselineResults = await runCasesForRepo({
    artifactPath: input.artifactPath,
    repoPath: input.baselineRepoPath,
    spec,
  });

  if (baselineResults.status !== "passed") {
    return failedValidation({
      hiddenTestsPath: input.hiddenTestsPath,
      ecosystem: spec.ecosystem,
      retryCount: input.attempt,
      wrapperEntrypoints: [spec.wrapper.path],
      targetSymbols: generation.targetSymbols || input.targetSymbols,
      baselineReason: baselineResults.reason || "Baseline oracle execution failed.",
      baselineOutput: baselineResults.output,
      candidateReason: "Baseline oracle could not be established.",
      rejectedReason: baselineResults.reason || "Baseline oracle execution failed.",
    });
  }

  const candidateResults = await runCasesForRepo({
    artifactPath: input.artifactPath,
    repoPath: input.candidateRepoPath,
    spec,
    oracle: baselineResults.caseOutputs,
  });

  const overall = compareCaseResults(spec, candidateResults.caseExecutions);

  return {
    status: overall.status,
    ecosystem: spec.ecosystem,
    hiddenTestsPath: input.hiddenTestsPath,
    retryCount: input.attempt,
    wrapperEntrypoints: [spec.wrapper.path],
    targetSymbols: generation.targetSymbols || input.targetSymbols,
    baseline: {
      target: "baseline",
      status: "passed",
      command: renderWrapperCommand(spec),
      exitCode: 0,
      output: trimOutput(baselineResults.output),
    },
    candidate: {
      target: "candidate",
      status: overall.candidateStatus,
      command: renderWrapperCommand(spec),
      exitCode: overall.candidateStatus === "failed" ? 1 : 0,
      output: trimOutput(candidateResults.output),
      reason: overall.reason,
    },
    notes: [
      "Deterministic hidden tests were generated from the bug report and changed files.",
      "Expected outputs were captured from baseline-repo and compared against candidate-repo.",
    ],
    rejectedReason: overall.status === "passed" ? undefined : overall.reason,
  };
}

async function runCasesForRepo(input: {
  artifactPath: string;
  repoPath: string;
  spec: HiddenTestSpec;
  oracle?: Record<string, string>;
}): Promise<{
  status: "passed" | "failed";
  reason?: string;
  output?: string;
  caseOutputs: Record<string, string>;
  caseExecutions: CaseExecution[];
}> {
  const caseOutputs: Record<string, string> = {};
  const caseExecutions: CaseExecution[] = [];
  const logs: string[] = [];

  for (const testCase of input.spec.cases) {
    const execution = await executeCase({
      artifactPath: input.artifactPath,
      repoPath: input.repoPath,
      spec: input.spec,
      testCase,
    });

    logs.push(execution.output ? `${testCase.id}: ${execution.output}` : `${testCase.id}: ${execution.reason || "failed"}`);

    if (execution.status === "failed") {
      return {
        status: "failed",
        reason: execution.reason || `Wrapper execution failed for case ${testCase.id}.`,
        output: logs.join("\n"),
        caseOutputs,
        caseExecutions,
      };
    }

    caseOutputs[testCase.id] = execution.output;
    const matchedBaseline =
      input.oracle === undefined ? undefined : input.oracle[testCase.id] === execution.output;

    caseExecutions.push({
      caseId: testCase.id,
      category: testCase.category,
      matchedBaseline,
      output: execution.output,
    });
  }

  return {
    status: "passed",
    output: logs.join("\n"),
    caseOutputs,
    caseExecutions,
  };
}

async function executeCase(input: {
  artifactPath: string;
  repoPath: string;
  spec: HiddenTestSpec;
  testCase: HiddenTestSpec["cases"][number];
}): Promise<{ status: "passed" | "failed"; output: string; reason?: string }> {
  const wrapperPath = path.join(input.artifactPath, input.spec.wrapper.path);
  const command = await resolveWrapperCommand(input.repoPath, wrapperPath, input.spec.wrapper.kind);

  try {
    const { stdout, stderr } = await execFileAsync(command.executable, [...command.args, "--repo", input.repoPath, "--case-json", JSON.stringify(input.testCase)], {
      cwd: input.artifactPath,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const output = stdout.trim();
    if (!output) {
      return {
        status: "failed",
        output: trimOutput(stderr) || "",
        reason: `Wrapper produced no stdout for case ${input.testCase.id}.`,
      };
    }

    JSON.parse(output);

    return {
      status: "passed",
      output,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      status: "failed",
      output: trimOutput(`${execError.stdout || ""}\n${execError.stderr || ""}`) || "",
      reason: execError.message || `Wrapper execution failed for case ${input.testCase.id}.`,
    };
  }
}

async function resolveWrapperCommand(
  repoPath: string,
  wrapperPath: string,
  kind: "python" | "node",
): Promise<{ executable: string; args: string[] }> {
  if (kind === "node") {
    return {
      executable: "node",
      args: [wrapperPath],
    };
  }

  const python = await resolvePythonExecutable(repoPath);
  return {
    executable: python,
    args: [wrapperPath],
  };
}

async function resolvePythonExecutable(repoPath: string): Promise<string> {
  const candidates = [
    path.join(repoPath, ".venv", "bin", "python"),
    path.join(repoPath, "venv", "bin", "python"),
    "python3",
    "python",
  ];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !(await pathExists(candidate))) {
      continue;
    }

    try {
      await execFileAsync(candidate, ["--version"], {
        cwd: repoPath,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("No usable Python executable was found for wrapper execution.");
}

export function compareCaseResults(
  spec: HiddenTestSpec,
  executions: CaseExecution[],
): { status: AssessmentValidation["status"]; candidateStatus: AssessmentValidationRun["status"]; reason?: string } {
  if (spec.cases.length !== executions.length) {
    return {
      status: "failed",
      candidateStatus: "failed",
      reason: "Hidden test execution did not cover every declared case.",
    };
  }

  const controlCases = executions.filter((execution) => execution.category === "control");
  const exposingCases = executions.filter((execution) => execution.category === "exposes_bug");

  if (controlCases.some((execution) => execution.matchedBaseline === false)) {
    return {
      status: "failed",
      candidateStatus: "failed",
      reason: "Candidate repo changed behavior for control cases that should remain stable.",
    };
  }

  if (exposingCases.every((execution) => execution.matchedBaseline === true)) {
    return {
      status: "failed",
      candidateStatus: "passed",
      reason: "Candidate repo matched baseline for all bug-exposing cases.",
    };
  }

  if (exposingCases.some((execution) => execution.matchedBaseline === false)) {
    return {
      status: "passed",
      candidateStatus: "failed",
      reason: "Candidate repo diverged from baseline on bug-exposing cases as expected.",
    };
  }

  return {
    status: "failed",
    candidateStatus: "failed",
    reason: "Hidden test comparison did not produce a valid pass/fail split.",
  };
}

export function validateSpec(spec: HiddenTestSpec): string | undefined {
  if (spec.ecosystem !== "python" && spec.ecosystem !== "node") {
    return "Hidden test spec must declare ecosystem as python or node.";
  }

  if (spec.wrapper?.kind !== "python" && spec.wrapper?.kind !== "node") {
    return "Hidden test spec must declare wrapper kind as python or node.";
  }

  if (spec.wrapper.kind !== spec.ecosystem) {
    return "Hidden test spec wrapper kind must match ecosystem.";
  }

  if (!spec.wrapper?.path) {
    return "Hidden test spec did not declare a wrapper path.";
  }

  if (!Array.isArray(spec.cases) || spec.cases.length < 2) {
    return "Hidden test spec must contain at least two deterministic cases.";
  }

  const hasControl = spec.cases.some((testCase) => testCase.category === "control");
  const hasExpose = spec.cases.some((testCase) => testCase.category === "exposes_bug");

  if (!hasControl || !hasExpose) {
    return "Hidden test spec must contain at least one control case and one exposes_bug case.";
  }

  if (!spec.cases.every((testCase) => typeof testCase.id === "string" && testCase.id.length > 0)) {
    return "Each hidden test case must have a non-empty id.";
  }

  const uniqueIds = new Set(spec.cases.map((testCase) => testCase.id));
  if (uniqueIds.size !== spec.cases.length) {
    return "Each hidden test case id must be unique.";
  }

  return undefined;
}

async function loadPrompt(): Promise<string> {
  return readFile(path.resolve(process.cwd(), "prompts", "generate-hidden-tests.md"), "utf8");
}

async function loadSpec(specPath: string): Promise<HiddenTestSpec | undefined> {
  try {
    return JSON.parse(await readFile(specPath, "utf8")) as HiddenTestSpec;
  } catch {
    return undefined;
  }
}

async function resetHiddenTestsPath(hiddenTestsPath: string): Promise<void> {
  await rm(hiddenTestsPath, { recursive: true, force: true });
  await mkdir(hiddenTestsPath, { recursive: true });
  await writeFile(
    path.join(hiddenTestsPath, "README.md"),
    `# Hidden Tests

This directory is non-candidate-facing.
`,
    "utf8",
  );
}

export function extractTargetSymbols(bugReport: string, filesChanged: string[]): string[] {
  const backticked = Array.from(bugReport.matchAll(/`([^`]+)`/g), (match) => match[1]);
  const relevant = backticked.filter(
    (value) =>
      !value.includes("/") &&
      !value.includes(".py") &&
      !value.includes(".ts") &&
      !value.includes(".js") &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(value),
  );

  const fileDerived = filesChanged
    .map((file) => path.basename(file, path.extname(file)))
    .filter(Boolean);

  return Array.from(new Set([...relevant, ...fileDerived]));
}

function parseGenerationJson(output: string): HiddenTestGenerationJson | undefined {
  const stringsToInspect = collectEventStrings(output);

  for (const value of stringsToInspect.reverse()) {
    const parsed = parseJsonObjectFromText(value);
    if (parsed && typeof parsed.wrapperPath === "string") {
      return parsed;
    }
  }

  return parseJsonObjectFromText(output);
}

function collectEventStrings(output: string): string[] {
  const values: string[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      collectStrings(JSON.parse(line), values);
    } catch {
      values.push(line);
    }
  }

  return values;
}

function collectStrings(value: unknown, results: string[]): void {
  if (typeof value === "string") {
    results.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, results);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, results);
    }
  }
}

function parseJsonObjectFromText(text: string): HiddenTestGenerationJson | undefined {
  const candidates = findJsonObjectCandidates(text);

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as HiddenTestGenerationJson;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function findJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function failedValidation(input: {
  hiddenTestsPath: string;
  ecosystem: AssessmentValidation["ecosystem"];
  retryCount: number;
  wrapperEntrypoints: string[];
  targetSymbols: string[];
  baselineReason: string;
  candidateReason: string;
  baselineOutput?: string;
  rejectedReason: string;
}): AssessmentValidation {
  return {
    status: "failed",
    ecosystem: input.ecosystem,
    hiddenTestsPath: input.hiddenTestsPath,
    retryCount: input.retryCount,
    wrapperEntrypoints: input.wrapperEntrypoints,
    targetSymbols: input.targetSymbols,
    baseline: {
      target: "baseline",
      status: "failed",
      reason: input.baselineReason,
      output: input.baselineOutput,
    },
    candidate: {
      target: "candidate",
      status: "failed",
      reason: input.candidateReason,
    },
    notes: [
      "Hidden test generation failed validation and will be retried or rejected.",
    ],
    rejectedReason: input.rejectedReason,
  };
}

function skippedValidation(
  hiddenTestsPath: string,
  targetSymbols: string[],
): AssessmentValidation {
  return {
    status: "skipped",
    ecosystem: "unknown",
    hiddenTestsPath,
    retryCount: 0,
    wrapperEntrypoints: [],
    targetSymbols,
    baseline: {
      target: "baseline",
      status: "skipped",
      reason: "No hidden tests were generated yet.",
    },
    candidate: {
      target: "candidate",
      status: "skipped",
      reason: "No hidden tests were generated yet.",
    },
    notes: ["Hidden test generation has not completed."],
  };
}

function renderWrapperCommand(spec: HiddenTestSpec): string {
  return spec.wrapper.kind === "node"
    ? `node ${spec.wrapper.path} --repo <repo> --case-json <json>`
    : `python ${spec.wrapper.path} --repo <repo> --case-json <json>`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function trimOutput(output: string | undefined): string | undefined {
  if (!output) {
    return output;
  }

  const trimmed = output.trim();
  if (trimmed.length <= 12000) {
    return trimmed;
  }

  return `${trimmed.slice(0, 12000)}\n...<truncated>`;
}
