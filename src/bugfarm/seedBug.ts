import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { runCursorAgent } from "../cursor/client.js";
import { getChangedFiles } from "./git.js";
import { resolveRepoTarget } from "./repoTarget.js";
import { scanRepo } from "./repoScanner.js";
import type { BugDifficulty, SeedBugRequest, SeedBugSuccess } from "./types.js";

type AgentFinalJson = {
  summary?: string;
  difficulty?: BugDifficulty;
  bugCount?: number;
  filesChanged?: string[];
  bugReportPath?: string;
};

const BUG_REPORT_REPAIR_ATTEMPTS = 1;

export async function seedBug(request: SeedBugRequest): Promise<SeedBugSuccess> {
  await validateSeedBugRequest(request);
  const repoTarget = await resolveRepoTarget(request.repoPath);
  const bugCount = getBugCount(request);
  const basePrompt = await loadPrompt();
  const repoScan = await scanRepo(repoTarget.repoPath);
  const prompt = buildPrompt(basePrompt, {
    requestedRepoPath: repoTarget.requestedRepoPath,
    repoPath: repoTarget.repoPath,
    repoSource: repoTarget.repoSource,
    area: request.area,
    difficulty: request.difficulty,
    language: request.language,
    bugCount,
    bugDiversification: request.bugDiversification ?? true,
    fileTree: repoScan.fileTree,
    sourceContext: repoScan.sourceContext,
  });

  const agentOutput = await runCursorAgent({
    repoPath: repoTarget.repoPath,
    prompt,
    model: config.modelName,
  });

  const bugReportPath = path.join(repoTarget.repoPath, "BUG_REPORT.md");
  let filesChanged = await getChangedFiles(repoTarget.repoPath);
  const repairOutputs = await createMissingBugReportIfNeeded({
    repoPath: repoTarget.repoPath,
    bugReportPath,
    requestedDifficulty: request.difficulty || "medium",
    requestedBugCount: bugCount,
    filesChanged,
    agentOutput,
  });
  filesChanged = await getChangedFiles(repoTarget.repoPath);

  const parsed = parseAgentFinalJson([agentOutput, ...repairOutputs].join("\n"));

  return {
    status: "success",
    requestedRepoPath: repoTarget.requestedRepoPath,
    repoPath: repoTarget.repoPath,
    repoSource: repoTarget.repoSource,
    summary: parsed?.summary || `Seeded ${bugCount} realistic intentional bug${bugCount === 1 ? "" : "s"}`,
    difficulty: parsed?.difficulty || request.difficulty || "medium",
    bugCount: parsed?.bugCount || bugCount,
    filesChanged: filesChanged.length > 0 ? filesChanged : parsed?.filesChanged || [],
    bugReportPath,
  };
}

export async function validateSeedBugRequest(request: SeedBugRequest): Promise<void> {
  if (!request || typeof request.repoPath !== "string" || request.repoPath.trim() === "") {
    throw new Error("repoPath is required");
  }

  if (request.difficulty && !["easy", "medium", "hard"].includes(request.difficulty)) {
    throw new Error("difficulty must be easy, medium, or hard");
  }

  if (
    request.bugDiversification !== undefined &&
    typeof request.bugDiversification !== "boolean"
  ) {
    throw new Error("bugDiversification must be a boolean");
  }

  getBugCount(request);
}

function getBugCount(request: SeedBugRequest): number {
  const rawBugCount = request.bugCount ?? request.numberOfBugs ?? 1;

  if (!Number.isInteger(rawBugCount)) {
    throw new Error("bugCount must be an integer");
  }

  if (rawBugCount < 1 || rawBugCount > 10) {
    throw new Error("bugCount must be between 1 and 10");
  }

  return rawBugCount;
}

async function loadPrompt(): Promise<string> {
  const promptPath = path.resolve(process.cwd(), "prompts", "seed-bug.md");
  return readFile(promptPath, "utf8");
}

function buildPrompt(
  basePrompt: string,
  input: {
    requestedRepoPath: string;
    repoPath: string;
    repoSource: "local" | "github";
    area?: string;
    difficulty?: BugDifficulty;
    language?: string;
    bugCount: number;
    bugDiversification: boolean;
    fileTree: string;
    sourceContext: string;
  },
): string {
  return `${basePrompt}

Repository path:
${input.repoPath}

Requested repository input:
${input.requestedRepoPath}

Repository source:
${input.repoSource}

Requested constraints:
- Area: ${input.area || "any suitable area"}
- Difficulty: ${input.difficulty || "medium"}
- Language: ${input.language || "infer from repository"}
- Number of bugs: ${input.bugCount}
- Diversify bugs when multiple bugs are requested: ${input.bugDiversification ? "yes" : "no"}

Repository file tree:
\`\`\`text
${input.fileTree}
\`\`\`

Selected source context:
\`\`\`text
${input.sourceContext}
\`\`\`

Bug diversification requirements:
- If diversification is enabled and more than one bug is requested, prefer materially different bug categories, modules, and failure modes rather than repeating the same pattern.
- If diversification is disabled, you may keep bugs concentrated in one theme or bug family when that better fits the repository.

Use the repository path as your working directory. Apply the minimal code edit directly in that repository, introduce exactly ${input.bugCount} bug${input.bugCount === 1 ? "" : "s"}, create BUG_REPORT.md at the repository root, read BUG_REPORT.md back to verify it exists, and finish with only the requested JSON object. Do not finish until BUG_REPORT.md exists.`;
}

async function createMissingBugReportIfNeeded(input: {
  repoPath: string;
  bugReportPath: string;
  requestedDifficulty: BugDifficulty;
  requestedBugCount: number;
  filesChanged: string[];
  agentOutput: string;
}): Promise<string[]> {
  if (await fileExists(input.bugReportPath)) {
    return [];
  }

  const repairOutputs: string[] = [];
  let latestFilesChanged = input.filesChanged;

  for (let attempt = 1; attempt <= BUG_REPORT_REPAIR_ATTEMPTS; attempt += 1) {
    const output = await runCursorAgent({
      repoPath: input.repoPath,
      prompt: buildBugReportRepairPrompt({
        repoPath: input.repoPath,
        difficulty: input.requestedDifficulty,
        bugCount: input.requestedBugCount,
        filesChanged: latestFilesChanged,
        previousFinalJson: parseAgentFinalJson(input.agentOutput),
      }),
      model: config.modelName,
    });
    repairOutputs.push(output);

    if (await fileExists(input.bugReportPath)) {
      return repairOutputs;
    }

    latestFilesChanged = await getChangedFiles(input.repoPath);
  }

  throw new Error("BUG_REPORT.md was not created after repair attempt");
}

export function buildBugReportRepairPrompt(input: {
  repoPath: string;
  difficulty: BugDifficulty;
  bugCount: number;
  filesChanged: string[];
  previousFinalJson?: AgentFinalJson;
}): string {
  return `The previous bug-seeding run changed the repository but did not create BUG_REPORT.md.

Repository path:
${input.repoPath}

Your task:
- Work in the repository path above.
- Inspect the current git diff and changed files.
- Create BUG_REPORT.md at the repository root.
- Document the already seeded bug${input.bugCount === 1 ? "" : "s"}.
- Do not modify source code unless it is absolutely required to accurately document the already seeded bug${input.bugCount === 1 ? "" : "s"}.
- Do not modify tests, lock files, dependency manifests, generated files, or build outputs.
- Read BUG_REPORT.md back after writing it and do not finish until it exists.

Changed files reported by git:
${input.filesChanged.length > 0 ? input.filesChanged.map((file) => `- ${file}`).join("\n") : "- No changed files were reported yet. Inspect git diff directly."}

Requested metadata:
- Difficulty: ${input.difficulty}
- Number of bugs: ${input.bugCount}

${input.previousFinalJson ? `Previous final JSON:\n\`\`\`json\n${JSON.stringify(input.previousFinalJson, null, 2)}\n\`\`\`\n` : ""}
BUG_REPORT.md must include:
1. Bug summary for each seeded bug
2. Files changed
3. Reproduction steps for each seeded bug
4. Expected vs actual behavior for each seeded bug
5. Difficulty: easy | medium | hard
6. Suggested test that should catch each bug

Finish with only this JSON object:
{
  "summary": string,
  "difficulty": "easy" | "medium" | "hard",
  "bugCount": number,
  "filesChanged": string[],
  "bugReportPath": "BUG_REPORT.md"
}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseAgentFinalJson(output: string): AgentFinalJson | undefined {
  const stringsToInspect = collectEventStrings(output);

  for (const value of stringsToInspect.reverse()) {
    const parsed = parseJsonObjectFromText(value);
    if (parsed && typeof parsed.summary === "string") {
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

function parseJsonObjectFromText(text: string): AgentFinalJson | undefined {
  const candidates = findJsonObjectCandidates(text);

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as AgentFinalJson;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.summary === "string" &&
        Array.isArray(parsed.filesChanged)
      ) {
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
