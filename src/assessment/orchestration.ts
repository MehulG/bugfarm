import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { createCandidateLaunchForAssessment } from "../candidate/flow.js";
import { evaluateSubmittedRepoAgainstHiddenTests } from "./hiddenTests.js";
import { runCursorAgent } from "../cursor/client.js";
import { getChangedFiles } from "../codesheep/git.js";
import { resolveRepoTarget } from "../codesheep/repoTarget.js";
import { scanRepo } from "../codesheep/repoScanner.js";
import {
  buildRubric,
  createArtifactPaths,
  type ArtifactPaths,
  writeAssessmentMetadata,
  writeJsonFile,
} from "./artifacts.js";
import {
  copyRepo,
  initializeArtifactWorkspace,
  prepareCandidateRepo,
  writeBugPatch,
} from "./repoOps.js";
import { writeCandidateTask } from "./task.js";
import {
  createAndValidateHiddenTests,
} from "./hiddenTests.js";
import type {
  AdversarialSolverResult,
  AssignmentQualityReport,
  AssessmentMetadata,
  AssessmentOrchestrationEvidence,
  BugDesign,
  GenerateAssessmentRequest,
  GenerateAssessmentSuccess,
  OrchestrationAttempt,
  RepoProfile,
} from "./types.js";

type CursorRunner = typeof runCursorAgent;
type HiddenTestCreator = typeof createAndValidateHiddenTests;

export type OrchestrationDependencies = {
  runCursorAgent?: CursorRunner;
  createAndValidateHiddenTests?: HiddenTestCreator;
  createCandidateLaunchForAssessment?: typeof createCandidateLaunchForAssessment;
  createArtifactPaths?: (assessmentName?: string) => Promise<ArtifactPaths>;
};

type SeedJson = {
  summary?: string;
  difficulty?: "easy" | "medium" | "hard";
  bugCount?: number;
  filesChanged?: string[];
  bugReportPath?: string;
};

type SolverJson = {
  summary?: string;
  filesInspected?: number;
  changedFiles?: string[];
};

const DEFAULT_DESIGN_COUNT = 5;
const DEFAULT_SEED_ATTEMPT_COUNT = 2;

export async function generateOrchestratedAssessment(
  request: GenerateAssessmentRequest,
  deps: OrchestrationDependencies = {},
): Promise<GenerateAssessmentSuccess> {
  const runner = deps.runCursorAgent ?? runCursorAgent;
  const hiddenTestCreator = deps.createAndValidateHiddenTests ?? createAndValidateHiddenTests;
  const launchCreator = deps.createCandidateLaunchForAssessment ?? createCandidateLaunchForAssessment;
  const artifactPathCreator = deps.createArtifactPaths ?? createArtifactPaths;
  const assessmentName = request.assessmentName || "Codesheep Debugging Assessment";
  const repoTarget = await resolveRepoTarget(request.repoPath);
  const repoScan = await scanRepo(repoTarget.repoPath);
  const designCount = clampInteger(request.designCount ?? DEFAULT_DESIGN_COUNT, 1, 10);
  const seedAttemptCount = clampInteger(request.seedAttemptCount ?? DEFAULT_SEED_ATTEMPT_COUNT, 1, designCount);
  const solverEnabled = request.adversarialSolver ?? true;

  const profile = await profileRepoForBugTargets({
    repoPath: repoTarget.repoPath,
    requestedRepoPath: repoTarget.requestedRepoPath,
    repoSource: repoTarget.repoSource,
    area: request.area,
    difficulty: request.difficulty,
    language: request.language,
    fileTree: repoScan.fileTree,
    sourceContext: repoScan.sourceContext,
    runCursorAgent: runner,
  });
  const designs = await proposeBugDesigns({
    repoPath: repoTarget.repoPath,
    difficulty: request.difficulty || "medium",
    bugCount: request.bugCount ?? request.numberOfBugs ?? 1,
    designCount,
    bugDiversification: request.bugDiversification ?? true,
    profile,
    fileTree: repoScan.fileTree,
    sourceContext: repoScan.sourceContext,
    runCursorAgent: runner,
  });

  const attempts: OrchestrationAttempt[] = [];

  for (const design of designs.slice(0, seedAttemptCount)) {
    const attempt = await trySeedAndValidateDesign({
      request,
      assessmentName,
      repoTarget,
      design,
      profile,
      designs,
      attempts,
      solverEnabled,
      runCursorAgent: runner,
      createAndValidateHiddenTests: hiddenTestCreator,
      createArtifactPaths: artifactPathCreator,
    });
    attempts.push(attempt);

    if (isAcceptableAttempt(attempt)) {
      const artifactPath = attempt.artifactPath;
      if (!artifactPath) {
        continue;
      }
      const metadata = await loadAttemptMetadata(artifactPath);
      const orchestration: AssessmentOrchestrationEvidence = {
        mode: "standard",
        profile,
        designs,
        selectedDesign: attempt.design,
        attempts,
      };
      await writeAssessmentMetadata({
        ...metadata,
        orchestration,
      });
      const candidateLaunch = await launchCreator({
        assessmentId: metadata.assessmentId,
        artifactPath: metadata.artifactPath,
      });

      return {
        status: "success",
        assessmentId: metadata.assessmentId,
        assessmentName: metadata.assessmentName,
        candidateLaunchUrl: candidateLaunch.candidateLaunchUrl,
        artifactPath: metadata.artifactPath,
        candidateRepoPath: metadata.candidateRepoPath,
        baselineRepoPath: metadata.baselineRepoPath,
        hiddenTestsPath: metadata.hiddenTestsPath,
        validation: metadata.validation!,
        filesChanged: metadata.filesChanged,
        summary: metadata.summary,
        difficulty: metadata.difficulty,
        bugCount: metadata.bugCount,
        bugReportPath: metadata.bugReportPath,
        taskPath: metadata.taskPath,
        patchPath: metadata.patchPath,
        rubricPath: metadata.rubricPath,
        orchestration,
      };
    }
  }

  const reasons = attempts
    .map((attempt) => `${attempt.design.id}: ${attempt.rejectedReason || "not accepted"}`)
    .join("; ");
  throw new Error(`No orchestrated assignment candidate survived validation: ${reasons || "no attempts were run"}`);
}

export async function profileRepoForBugTargets(input: {
  repoPath: string;
  requestedRepoPath: string;
  repoSource: "local" | "github";
  area?: string;
  difficulty?: string;
  language?: string;
  fileTree: string;
  sourceContext: string;
  runCursorAgent?: CursorRunner;
}): Promise<RepoProfile> {
  const prompt = `${await loadPrompt("profile-repo.md")}

Repository path:
${input.repoPath}

Requested repository input:
${input.requestedRepoPath}

Repository source: ${input.repoSource}
Area: ${input.area || "any suitable area"}
Difficulty: ${input.difficulty || "medium"}
Language: ${input.language || "infer from repository"}

Repository file tree:
\`\`\`text
${input.fileTree}
\`\`\`

Selected source context:
\`\`\`text
${input.sourceContext}
\`\`\``;

  const output = await (input.runCursorAgent ?? runCursorAgent)({
    repoPath: input.repoPath,
    prompt,
    model: config.modelName,
  });
  const parsed = parseJsonObject(output) as Partial<RepoProfile> | undefined;

  return {
    workflows: stringArray(parsed?.workflows),
    highValueTargets: stringArray(parsed?.highValueTargets),
    edgeCases: stringArray(parsed?.edgeCases),
    testableEntryPoints: stringArray(parsed?.testableEntryPoints),
    notes: typeof parsed?.notes === "string" ? parsed.notes : undefined,
  };
}

export async function proposeBugDesigns(input: {
  repoPath: string;
  difficulty: "easy" | "medium" | "hard";
  bugCount: number;
  designCount: number;
  bugDiversification: boolean;
  profile: RepoProfile;
  fileTree: string;
  sourceContext: string;
  runCursorAgent?: CursorRunner;
}): Promise<BugDesign[]> {
  const prompt = `${await loadPrompt("propose-bug-designs.md")}

Requested difficulty: ${input.difficulty}
Requested bug count per assignment: ${input.bugCount}
Number of designs to propose: ${input.designCount}
Diversify bug designs: ${input.bugDiversification ? "yes" : "no"}

Repo profile:
\`\`\`json
${JSON.stringify(input.profile, null, 2)}
\`\`\`

Repository file tree:
\`\`\`text
${input.fileTree}
\`\`\`

Selected source context:
\`\`\`text
${input.sourceContext}
\`\`\``;

  const output = await (input.runCursorAgent ?? runCursorAgent)({
    repoPath: input.repoPath,
    prompt,
    model: config.modelName,
  });
  const parsed = parseJsonObject(output) as { designs?: unknown[] } | undefined;
  const designs = Array.isArray(parsed?.designs)
    ? parsed.designs.map(toBugDesign).filter((design): design is BugDesign => Boolean(design))
    : [];

  if (designs.length === 0) {
    throw new Error("Bug design orchestration did not produce any valid designs.");
  }

  return designs.slice(0, input.designCount);
}

export async function seedSelectedBugDesign(input: {
  repoPath: string;
  design: BugDesign;
  profile: RepoProfile;
  runCursorAgent?: CursorRunner;
}): Promise<SeedJson> {
  const prompt = `${await loadPrompt("seed-selected-bug.md")}

Selected design:
\`\`\`json
${JSON.stringify(input.design, null, 2)}
\`\`\`

Repo profile:
\`\`\`json
${JSON.stringify(input.profile, null, 2)}
\`\`\`

Use the repository path as your working directory. Apply the minimal code edit directly in that repository, create BUG_REPORT.md, read BUG_REPORT.md back to verify it exists, and finish with only the requested JSON object.`;

  const output = await (input.runCursorAgent ?? runCursorAgent)({
    repoPath: input.repoPath,
    prompt,
    model: config.modelName,
  });
  return (parseJsonObject(output) as SeedJson | undefined) || {};
}

export async function runAdversarialSolver(input: {
  artifactPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  baselineRepoPath: string;
  runCursorAgent?: CursorRunner;
}): Promise<AdversarialSolverResult> {
  const solverRoot = await mkdtemp(path.join(os.tmpdir(), "codesheep-solver-"));
  const solverRepoPath = path.join(solverRoot, "repo");
  await copyRepo(input.candidateRepoPath, solverRepoPath);

  const prompt = `${await loadPrompt("adversarial-solve.md")}

Repository path:
${solverRepoPath}`;

  const output = await (input.runCursorAgent ?? runCursorAgent)({
    repoPath: solverRepoPath,
    prompt,
    model: config.modelName,
  });
  const parsed = (parseJsonObject(output) as SolverJson | undefined) || {};
  const changedFiles = await getChangedFiles(solverRepoPath);
  const hiddenResult = await evaluateSubmittedRepoAgainstHiddenTests({
    artifactPath: input.artifactPath,
    baselineRepoPath: input.baselineRepoPath,
    submittedRepoPath: solverRepoPath,
    hiddenTestsPath: input.hiddenTestsPath,
  });
  const filesInspected = Number.isFinite(parsed.filesInspected) ? Number(parsed.filesInspected) : undefined;
  const solved = hiddenResult.score >= 70;

  return {
    attempted: true,
    solved,
    hiddenScore: hiddenResult.score,
    filesInspected,
    changedFiles: changedFiles.length > 0 ? changedFiles : stringArray(parsed.changedFiles),
    summary: parsed.summary || hiddenResult.reason || "Adversarial solver run completed.",
    tooEasy: solved && (filesInspected ?? 99) <= 3 && changedFiles.length <= 1,
  };
}

export async function judgeAssignmentQuality(input: {
  artifactPath: string;
  design: BugDesign;
  filesChanged: string[];
  validationStatus: string;
  solver?: AdversarialSolverResult;
  runCursorAgent?: CursorRunner;
}): Promise<AssignmentQualityReport> {
  const prompt = `${await loadPrompt("judge-assignment.md")}

Design:
\`\`\`json
${JSON.stringify(input.design, null, 2)}
\`\`\`

Changed files:
${input.filesChanged.map((file) => `- ${file}`).join("\n")}

Hidden validation status: ${input.validationStatus}

Adversarial solver:
\`\`\`json
${JSON.stringify(input.solver, null, 2)}
\`\`\``;

  try {
    const output = await (input.runCursorAgent ?? runCursorAgent)({
      repoPath: input.artifactPath,
      prompt,
      model: config.modelName,
    });
    const parsed = parseJsonObject(output) as Partial<AssignmentQualityReport> | undefined;
    return {
      accepted: Boolean(parsed?.accepted),
      score: typeof parsed?.score === "number" ? parsed.score : 0,
      reasons: stringArray(parsed?.reasons),
      risks: stringArray(parsed?.risks),
    };
  } catch {
    return {
      accepted: true,
      score: 70,
      reasons: ["Quality judge was unavailable; accepted based on deterministic validation gates."],
      risks: [],
    };
  }
}

export function isForbiddenChangedFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  const base = path.basename(normalized);

  return (
    normalized.startsWith(".github/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/test/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    ["package.json", "package-lock.json", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pyproject.toml", "uv.lock", "poetry.lock"].includes(base)
  );
}

export function isTriviallySolved(solver?: AdversarialSolverResult): boolean {
  return Boolean(solver?.tooEasy);
}

async function trySeedAndValidateDesign(input: {
  request: GenerateAssessmentRequest;
  assessmentName: string;
  repoTarget: Awaited<ReturnType<typeof resolveRepoTarget>>;
  design: BugDesign;
  profile: RepoProfile;
  designs: BugDesign[];
  attempts: OrchestrationAttempt[];
  solverEnabled: boolean;
  runCursorAgent: CursorRunner;
  createAndValidateHiddenTests: HiddenTestCreator;
  createArtifactPaths: (assessmentName?: string) => Promise<ArtifactPaths>;
}): Promise<OrchestrationAttempt> {
  const attempt: OrchestrationAttempt = {
    design: input.design,
    filesChanged: [],
  };

  try {
    const artifactPaths = await input.createArtifactPaths(`${input.assessmentName} ${input.design.id}`);
    attempt.artifactPath = artifactPaths.artifactPath;
    await initializeArtifactWorkspace(artifactPaths.artifactPath);
    await copyRepo(input.repoTarget.repoPath, artifactPaths.baselineRepoPath);
    await copyRepo(artifactPaths.baselineRepoPath, artifactPaths.candidateRepoPath);

    const seedResult = await seedSelectedBugDesign({
      repoPath: artifactPaths.candidateRepoPath,
      design: input.design,
      profile: input.profile,
      runCursorAgent: input.runCursorAgent,
    });
    await copyFile(path.join(artifactPaths.candidateRepoPath, "BUG_REPORT.md"), artifactPaths.bugReportPath);
    await prepareCandidateRepo(artifactPaths.candidateRepoPath);
    const gitFilesChanged = await getChangedFiles(artifactPaths.candidateRepoPath);
    const filesChanged = gitFilesChanged.length > 0 ? gitFilesChanged : stringArray(seedResult.filesChanged);
    attempt.filesChanged = filesChanged;

    const rejectReason = validateChangedFilesForDesign(filesChanged, input.design, input.request.difficulty || "medium");
    if (rejectReason) {
      attempt.rejectedReason = rejectReason;
      return attempt;
    }

    await writeBugPatch(artifactPaths.candidateRepoPath, artifactPaths.patchPath);
    await writeCandidateTask({
      taskPath: artifactPaths.taskPath,
      assessmentName: input.assessmentName,
      request: input.request,
      filesChanged,
    });

    const rubric = buildRubric({
      difficulty: input.request.difficulty,
      bugCount: seedResult.bugCount || input.request.bugCount || input.request.numberOfBugs || 1,
      area: input.request.area,
      language: input.request.language,
      role: input.request.role,
    });
    await writeJsonFile(artifactPaths.rubricPath, rubric);

    const metadataBase: AssessmentMetadata = {
      assessmentId: artifactPaths.assessmentId,
      assessmentName: input.assessmentName,
      createdAt: new Date().toISOString(),
      stage: "bug-generated",
      requestedRepoPath: input.repoTarget.requestedRepoPath,
      repoSource: input.repoTarget.repoSource,
      artifactPath: artifactPaths.artifactPath,
      baselineRepoPath: artifactPaths.baselineRepoPath,
      candidateRepoPath: artifactPaths.candidateRepoPath,
      hiddenTestsPath: artifactPaths.hiddenTestsPath,
      bugReportPath: artifactPaths.bugReportPath,
      taskPath: artifactPaths.taskPath,
      patchPath: artifactPaths.patchPath,
      rubricPath: artifactPaths.rubricPath,
      summary: seedResult.summary || input.design.title,
      difficulty: seedResult.difficulty || input.design.difficulty,
      bugCount: seedResult.bugCount || 1,
      filesChanged,
      rubric,
      orchestration: {
        mode: "standard",
        profile: input.profile,
        designs: input.designs,
        selectedDesign: input.design,
        attempts: [...input.attempts, attempt],
      },
    };
    await writeAssessmentMetadata(metadataBase);

    const validation = await input.createAndValidateHiddenTests({
      artifactPath: artifactPaths.artifactPath,
      baselineRepoPath: artifactPaths.baselineRepoPath,
      candidateRepoPath: artifactPaths.candidateRepoPath,
      hiddenTestsPath: artifactPaths.hiddenTestsPath,
      bugReportPath: artifactPaths.bugReportPath,
      filesChanged,
      language: input.request.language,
    });
    attempt.validationStatus = validation.status;

    if (validation.status !== "passed") {
      attempt.rejectedReason =
        validation.rejectedReason ||
        validation.candidate.reason ||
        validation.baseline.reason ||
        "Hidden test validation failed.";
      await writeAssessmentMetadata({
        ...metadataBase,
        stage: "test-generation-failed",
        validation,
      });
      return attempt;
    }

    if (input.solverEnabled) {
      attempt.solver = await runAdversarialSolver({
        artifactPath: artifactPaths.artifactPath,
        candidateRepoPath: artifactPaths.candidateRepoPath,
        hiddenTestsPath: artifactPaths.hiddenTestsPath,
        baselineRepoPath: artifactPaths.baselineRepoPath,
        runCursorAgent: input.runCursorAgent,
      });

      if (isTriviallySolved(attempt.solver)) {
        attempt.rejectedReason = "Adversarial solver fixed the assignment with shallow exploration.";
        return attempt;
      }
    }

    attempt.quality = await judgeAssignmentQuality({
      artifactPath: artifactPaths.artifactPath,
      design: input.design,
      filesChanged,
      validationStatus: validation.status,
      solver: attempt.solver,
      runCursorAgent: input.runCursorAgent,
    });

    if (!attempt.quality.accepted || attempt.quality.score < 60) {
      attempt.rejectedReason = attempt.quality.reasons.join("; ") || "Assignment quality gate rejected the attempt.";
      return attempt;
    }

    await writeAssessmentMetadata({
      ...metadataBase,
      stage: "assessment-complete",
      validation,
    });
    return attempt;
  } catch (error) {
    attempt.rejectedReason = error instanceof Error ? error.message : "Unknown orchestration attempt error";
    return attempt;
  }
}

function validateChangedFilesForDesign(
  filesChanged: string[],
  design: BugDesign,
  difficulty: "easy" | "medium" | "hard",
): string | undefined {
  if (filesChanged.length === 0) {
    return "Bug seeding did not change any source files.";
  }

  const forbidden = filesChanged.filter(isForbiddenChangedFile);
  if (forbidden.length > 0) {
    return `Bug seeding touched forbidden files: ${forbidden.join(", ")}`;
  }

  const allowedFileCount = difficulty === "hard" ? 4 : difficulty === "medium" ? 3 : 2;
  if (filesChanged.length > allowedFileCount) {
    return `Bug seeding touched too many files for ${difficulty} difficulty: ${filesChanged.join(", ")}`;
  }

  const unexpected = filesChanged.filter((file) => !design.targetFiles.includes(file));
  if (design.targetFiles.length > 0 && unexpected.length > 0) {
    return `Bug seeding changed files outside selected design: ${unexpected.join(", ")}`;
  }

  return undefined;
}

function isAcceptableAttempt(attempt: OrchestrationAttempt): boolean {
  return (
    Boolean(attempt.artifactPath) &&
    attempt.validationStatus === "passed" &&
    !attempt.rejectedReason &&
    !isTriviallySolved(attempt.solver) &&
    (attempt.quality?.accepted ?? false)
  );
}

async function loadAttemptMetadata(artifactPath: string): Promise<AssessmentMetadata> {
  const raw = await readFile(path.join(artifactPath, "assessment.json"), "utf8");
  return JSON.parse(raw) as AssessmentMetadata;
}

async function loadPrompt(fileName: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), "prompts", fileName), "utf8");
}

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const candidates = collectJsonCandidates(text);
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function collectJsonCandidates(text: string): string[] {
  const values: string[] = [text];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed) as { text?: string; output?: string; content?: unknown };
      if (typeof event.text === "string") {
        values.push(event.text);
      }
      if (typeof event.output === "string") {
        values.push(event.output);
      }
      if (typeof event.content === "string") {
        values.push(event.content);
      }
    } catch {
      // Not an event envelope.
    }
  }

  const candidates: string[] = [];
  for (const value of values) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start !== -1 && end > start) {
      candidates.push(value.slice(start, end + 1));
    }
  }
  return candidates;
}

function toBugDesign(value: unknown): BugDesign | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined;
  const difficulty = record.difficulty;
  const risk = record.risk;

  if (!id || !title || !["easy", "medium", "hard"].includes(String(difficulty))) {
    return undefined;
  }

  return {
    id,
    title,
    category: typeof record.category === "string" ? record.category : "logic",
    difficulty: difficulty as BugDesign["difficulty"],
    targetFiles: stringArray(record.targetFiles),
    behaviorChange: typeof record.behaviorChange === "string" ? record.behaviorChange : title,
    whyRealistic: typeof record.whyRealistic === "string" ? record.whyRealistic : "",
    hiddenTestStrategy: stringArray(record.hiddenTestStrategy),
    risk: ["low", "medium", "high"].includes(String(risk)) ? (risk as BugDesign["risk"]) : "medium",
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function clampInteger(value: number, min: number, max: number): number {
  const integer = Math.trunc(value);
  if (!Number.isFinite(integer)) {
    return min;
  }
  return Math.max(min, Math.min(max, integer));
}
