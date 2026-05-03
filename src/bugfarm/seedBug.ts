import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { runCursorAgent } from "../cursor/client.js";
import { getChangedFiles } from "./git.js";
import { scanRepo, verifyRepoPath } from "./repoScanner.js";
import type { BugDifficulty, SeedBugRequest, SeedBugSuccess } from "./types.js";

type AgentFinalJson = {
  summary?: string;
  difficulty?: BugDifficulty;
  filesChanged?: string[];
  bugReportPath?: string;
};

export async function seedBug(request: SeedBugRequest): Promise<SeedBugSuccess> {
  const repoPath = await validateRequest(request);
  const basePrompt = await loadPrompt();
  const repoScan = await scanRepo(repoPath);
  const prompt = buildPrompt(basePrompt, {
    repoPath,
    area: request.area,
    difficulty: request.difficulty,
    language: request.language,
    fileTree: repoScan.fileTree,
    sourceContext: repoScan.sourceContext,
  });

  const agentOutput = await runCursorAgent({
    repoPath,
    prompt,
    model: config.modelName,
  });

  const filesChanged = await getChangedFiles(repoPath);
  const bugReportPath = path.join(repoPath, "BUG_REPORT.md");

  try {
    await access(bugReportPath);
  } catch {
    throw new Error("BUG_REPORT.md was not created");
  }

  const parsed = parseAgentFinalJson(agentOutput);

  return {
    status: "success",
    repoPath,
    summary: parsed?.summary || "Seeded a realistic intentional bug",
    difficulty: parsed?.difficulty || request.difficulty || "medium",
    filesChanged: filesChanged.length > 0 ? filesChanged : parsed?.filesChanged || [],
    bugReportPath,
  };
}

async function validateRequest(request: SeedBugRequest): Promise<string> {
  if (!request || typeof request.repoPath !== "string" || request.repoPath.trim() === "") {
    throw new Error("repoPath is required");
  }

  if (request.difficulty && !["easy", "medium", "hard"].includes(request.difficulty)) {
    throw new Error("difficulty must be easy, medium, or hard");
  }

  return verifyRepoPath(request.repoPath);
}

async function loadPrompt(): Promise<string> {
  const promptPath = path.resolve(process.cwd(), "prompts", "seed-bug.md");
  return readFile(promptPath, "utf8");
}

function buildPrompt(
  basePrompt: string,
  input: {
    repoPath: string;
    area?: string;
    difficulty?: BugDifficulty;
    language?: string;
    fileTree: string;
    sourceContext: string;
  },
): string {
  return `${basePrompt}

Repository path:
${input.repoPath}

Requested constraints:
- Area: ${input.area || "any suitable area"}
- Difficulty: ${input.difficulty || "medium"}
- Language: ${input.language || "infer from repository"}

Repository file tree:
\`\`\`text
${input.fileTree}
\`\`\`

Selected source context:
\`\`\`text
${input.sourceContext}
\`\`\`

Use the repository path as your working directory. Apply the minimal code edit directly in that repository, create BUG_REPORT.md at the repository root, and finish with only the requested JSON object.`;
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
