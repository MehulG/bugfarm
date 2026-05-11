import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CandidateSubmissionGitEvidence } from "../assessment/types.js";

const execFileAsync = promisify(execFile);
const PROJECT_DIR = "/home/coder/project";
const DOCKER_GIT_MARKERS = new Set([
  "OK",
  "BRANCH",
  "DIRTY",
  "NOT_GIT",
  "MISSING_BASELINE",
  "MISSING_MAIN",
]);

export class CandidateGitPreflightError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "CandidateGitPreflightError";
  }
}

export function buildCommitRequiredMessage(statusText?: string): string {
  const status = statusText?.trim() || "(git status unavailable)";
  return [
    "Please commit your work to the main branch before submitting.",
    "",
    "Run:",
    "  git status",
    "  git add -A",
    '  git commit -m "Complete assessment"',
    '  codesheep-submit --notes "what you changed and how you verified it"',
    "",
    "Current git status:",
    status,
  ].join("\n");
}

export async function validateLocalSubmissionGit(repoPath: string): Promise<CandidateSubmissionGitEvidence> {
  let inside: string;
  try {
    inside = await gitOutput(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new CandidateGitPreflightError("Submission requires a Git repository on the main branch.");
  }

  if (inside.trim() !== "true") {
    throw new CandidateGitPreflightError("Submission requires a Git repository on the main branch.");
  }

  const branch = (await gitOutput(repoPath, ["branch", "--show-current"])).trim();
  if (branch !== "main") {
    throw new CandidateGitPreflightError(
      `Please switch to the main branch before submitting. Current branch: ${branch || "(detached HEAD)"}`,
    );
  }

  let baselineCommit: string;
  try {
    baselineCommit = (await gitOutput(repoPath, ["rev-parse", "--verify", "codesheep-baseline^{commit}"])).trim();
  } catch {
    throw new CandidateGitPreflightError("Submission requires the codesheep-baseline Git tag.");
  }

  const status = await gitOutput(repoPath, ["status", "--short", "--untracked-files=all"]);
  if (status.trim()) {
    throw new CandidateGitPreflightError(buildCommitRequiredMessage(status));
  }

  const submittedCommit = (await gitOutput(repoPath, ["rev-parse", "--verify", "main^{commit}"])).trim();
  const changedFiles = (await gitOutput(repoPath, ["diff", "--name-only", "codesheep-baseline..main"]))
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);

  return {
    branch,
    baselineCommit,
    submittedCommit,
    changedFiles,
  };
}

export async function snapshotLocalCommittedMain(
  repoPath: string,
  destinationPath: string,
): Promise<CandidateSubmissionGitEvidence> {
  const evidence = await validateLocalSubmissionGit(repoPath);
  await mkdir(destinationPath, { recursive: true });
  const tarPath = path.join(await mkTempDir(), "submission.tar");

  try {
    await execFileAsync("git", ["-C", repoPath, "archive", "--format=tar", "-o", tarPath, "main"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    await execFileAsync("tar", ["-xf", tarPath, "-C", destinationPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    await rm(path.dirname(tarPath), { recursive: true, force: true });
  }

  return evidence;
}

export async function validateDockerSubmissionGit(containerName: string): Promise<CandidateSubmissionGitEvidence> {
  return parseDockerGitEvidence(
    await dockerProjectOutput(containerName, [
      "sh",
      "-lc",
      [
        "set -eu",
        'if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf "NOT_GIT\\n"; exit 23; fi',
        'branch="$(git branch --show-current)"',
        'if [ "$branch" != "main" ]; then printf "BRANCH\\n%s\\n" "$branch"; exit 21; fi',
        'if ! baseline="$(git rev-parse --verify codesheep-baseline^{commit} 2>/dev/null)"; then printf "MISSING_BASELINE\\n"; exit 24; fi',
        'status="$(git status --short --untracked-files=all)"',
        'if [ -n "$status" ]; then printf "DIRTY\\n%s\\n" "$status"; exit 22; fi',
        'if ! submitted="$(git rev-parse --verify main^{commit} 2>/dev/null)"; then printf "MISSING_MAIN\\n"; exit 25; fi',
        'printf "OK\\n%s\\n%s\\n%s\\n" "$branch" "$baseline" "$submitted"',
        "git diff --name-only codesheep-baseline..main",
      ].join("\n"),
    ]),
  );
}

export async function snapshotDockerCommittedMain(input: {
  containerName: string;
  destinationPath: string;
  snapshotRoot: string;
}): Promise<CandidateSubmissionGitEvidence> {
  const evidence = await validateDockerSubmissionGit(input.containerName);
  await mkdir(input.destinationPath, { recursive: true });
  const containerTarPath = `/tmp/codesheep-submission-${Date.now()}.tar`;
  const hostTarPath = path.join(input.snapshotRoot, "submission.tar");

  await dockerProjectOutput(input.containerName, [
    "git",
    "archive",
    "--format=tar",
    "-o",
    containerTarPath,
    "main",
  ]);
  await execFileAsync("docker", ["cp", `${input.containerName}:${containerTarPath}`, hostTarPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  await dockerProjectOutput(input.containerName, ["rm", "-f", containerTarPath]);
  await execFileAsync("tar", ["-xf", hostTarPath, "-C", input.destinationPath], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return evidence;
}

export function parseDockerGitEvidence(stdout: string): CandidateSubmissionGitEvidence {
  const lines = stdout.split("\n");
  const markerIndex = lines.findIndex((line) => DOCKER_GIT_MARKERS.has(line.trim()));
  const marker = markerIndex === -1 ? undefined : lines[markerIndex]?.trim();

  if (marker === "BRANCH") {
    throw new CandidateGitPreflightError(
      `Please switch to the main branch before submitting. Current branch: ${lines[markerIndex + 1]?.trim() || "(detached HEAD)"}`,
    );
  }

  if (marker === "DIRTY") {
    throw new CandidateGitPreflightError(buildCommitRequiredMessage(lines.slice(markerIndex + 1).join("\n")));
  }

  if (marker === "NOT_GIT") {
    throw new CandidateGitPreflightError(
      `Backend could not find a Git repository at ${PROJECT_DIR} inside the candidate container.`,
    );
  }

  if (marker === "MISSING_BASELINE") {
    throw new CandidateGitPreflightError("Submission requires the codesheep-baseline Git tag.");
  }

  if (marker === "MISSING_MAIN") {
    throw new CandidateGitPreflightError("Submission requires a valid main branch commit.");
  }

  if (marker !== "OK") {
    throw new CandidateGitPreflightError(
      `Backend Git preflight returned an unexpected response from ${PROJECT_DIR}: ${stdout.trim() || "(empty output)"}`,
    );
  }

  return {
    branch: lines[markerIndex + 1]?.trim() || "main",
    baselineCommit: lines[markerIndex + 2]?.trim() || "",
    submittedCommit: lines[markerIndex + 3]?.trim() || "",
    changedFiles: lines.slice(markerIndex + 4).map((file) => file.trim()).filter(Boolean),
  };
}

async function dockerProjectOutput(containerName: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", ["exec", "-w", PROJECT_DIR, containerName, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const typed = error as { stdout?: string; stderr?: string; code?: number };
    if (typed.code === 21 || typed.stdout?.startsWith("BRANCH\n")) {
      return typed.stdout ?? "";
    }
    if (typed.code === 22 || typed.stdout?.startsWith("DIRTY\n")) {
      return typed.stdout ?? "";
    }
    if (
      typed.code === 23 ||
      typed.code === 24 ||
      typed.code === 25 ||
      typed.stdout?.startsWith("NOT_GIT\n") ||
      typed.stdout?.startsWith("MISSING_BASELINE\n") ||
      typed.stdout?.startsWith("MISSING_MAIN\n")
    ) {
      return typed.stdout ?? "";
    }
    throw new CandidateGitPreflightError(
      [
        "Backend could not inspect the candidate workspace Git state.",
        `Container: ${containerName}`,
        `Working directory: ${PROJECT_DIR}`,
        typed.code === undefined ? undefined : `Exit code: ${typed.code}`,
        typed.stderr?.trim() ? `stderr: ${typed.stderr.trim()}` : undefined,
        typed.stdout?.trim() ? `stdout: ${typed.stdout.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

async function gitOutput(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function mkTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "codesheep-git-snapshot-"));
}
