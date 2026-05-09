import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CandidateSubmissionGitEvidence } from "../assessment/types.js";

const execFileAsync = promisify(execFile);
const PROJECT_DIR = "/home/coder/project";

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
        "git rev-parse --is-inside-work-tree >/dev/null",
        'branch="$(git branch --show-current)"',
        'if [ "$branch" != "main" ]; then printf "BRANCH\\n%s\\n" "$branch"; exit 21; fi',
        'baseline="$(git rev-parse --verify codesheep-baseline^{commit})"',
        'status="$(git status --short --untracked-files=all)"',
        'if [ -n "$status" ]; then printf "DIRTY\\n%s\\n" "$status"; exit 22; fi',
        'submitted="$(git rev-parse --verify main^{commit})"',
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

function parseDockerGitEvidence(stdout: string): CandidateSubmissionGitEvidence {
  const lines = stdout.split("\n");
  const marker = lines[0]?.trim();

  if (marker === "BRANCH") {
    throw new CandidateGitPreflightError(
      `Please switch to the main branch before submitting. Current branch: ${lines[1]?.trim() || "(detached HEAD)"}`,
    );
  }

  if (marker === "DIRTY") {
    throw new CandidateGitPreflightError(buildCommitRequiredMessage(lines.slice(1).join("\n")));
  }

  if (marker !== "OK") {
    throw new CandidateGitPreflightError("Submission requires a clean Git repository on the main branch.");
  }

  return {
    branch: lines[1]?.trim() || "main",
    baselineCommit: lines[2]?.trim() || "",
    submittedCommit: lines[3]?.trim() || "",
    changedFiles: lines.slice(4).map((file) => file.trim()).filter(Boolean),
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
    throw new CandidateGitPreflightError(
      `Submission requires a clean Git repository on main. ${typed.stderr?.trim() || ""}`.trim(),
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
