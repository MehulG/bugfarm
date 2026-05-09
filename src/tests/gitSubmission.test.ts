import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  CandidateGitPreflightError,
  snapshotLocalCommittedMain,
  validateLocalSubmissionGit,
} from "../candidate/gitSubmission.js";

const execFileAsync = promisify(execFile);

test("validateLocalSubmissionGit accepts a clean main branch with baseline tag", async () => {
  const repo = await createBaselineRepo();
  const evidence = await validateLocalSubmissionGit(repo);

  assert.equal(evidence.branch, "main");
  assert.equal(evidence.changedFiles.length, 0);
  assert.match(evidence.baselineCommit, /^[a-f0-9]{40}$/);
  assert.equal(evidence.submittedCommit, evidence.baselineCommit);
});

test("validateLocalSubmissionGit blocks dirty tracked and untracked files", async () => {
  const trackedRepo = await createBaselineRepo();
  await writeFile(path.join(trackedRepo, "src", "app.ts"), "export const value = 2;\n", "utf8");

  await assert.rejects(
    validateLocalSubmissionGit(trackedRepo),
    (error) =>
      error instanceof CandidateGitPreflightError &&
      error.message.includes("git commit") &&
      error.message.includes("src/app.ts"),
  );

  const untrackedRepo = await createBaselineRepo();
  await writeFile(path.join(untrackedRepo, "notes.txt"), "untracked\n", "utf8");

  await assert.rejects(
    validateLocalSubmissionGit(untrackedRepo),
    (error) =>
      error instanceof CandidateGitPreflightError &&
      error.message.includes("git commit") &&
      error.message.includes("notes.txt"),
  );
});

test("validateLocalSubmissionGit blocks non-main and missing Git repositories", async () => {
  const repo = await createBaselineRepo();
  await git(repo, ["checkout", "-b", "feature"]);

  await assert.rejects(
    validateLocalSubmissionGit(repo),
    (error) => error instanceof CandidateGitPreflightError && error.message.includes("main branch"),
  );

  const plainDir = await mkdtemp(path.join(os.tmpdir(), "codesheep-no-git-"));
  await assert.rejects(
    validateLocalSubmissionGit(plainDir),
    (error) => error instanceof CandidateGitPreflightError && error.message.includes("Git repository"),
  );
});

test("snapshotLocalCommittedMain archives only committed main and reports baseline diff files", async () => {
  const repo = await createBaselineRepo();
  await writeFile(path.join(repo, "src", "app.ts"), "export const value = 2;\n", "utf8");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "Complete assessment"]);
  await writeFile(path.join(repo, ".git", "info", "exclude"), "ignored.txt\n", "utf8");
  await writeFile(path.join(repo, "ignored.txt"), "not in archive\n", "utf8");

  const snapshot = await mkdtemp(path.join(os.tmpdir(), "codesheep-snapshot-"));
  const evidence = await snapshotLocalCommittedMain(repo, snapshot);

  assert.deepEqual(evidence.changedFiles, ["src/app.ts"]);
  assert.equal(await readFile(path.join(snapshot, "src", "app.ts"), "utf8"), "export const value = 2;\n");
  await assert.rejects(readFile(path.join(snapshot, ".git"), "utf8"));
  await assert.rejects(readFile(path.join(snapshot, "ignored.txt"), "utf8"));
});

async function createBaselineRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "codesheep-git-"));
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await git(repo, ["init"]);
  await git(repo, ["branch", "-M", "main"]);
  await git(repo, ["config", "user.name", "Codesheep Test"]);
  await git(repo, ["config", "user.email", "test@codesheep.local"]);
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "Initial assessment baseline"]);
  await git(repo, ["tag", "codesheep-baseline"]);
  return repo;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}
