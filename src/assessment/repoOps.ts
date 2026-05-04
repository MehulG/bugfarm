import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "artifacts",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
]);
const POST_SEED_RESTORE_PATHS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
];

export async function copyRepo(sourcePath: string, destinationPath: string): Promise<void> {
  await cp(sourcePath, destinationPath, {
    recursive: true,
    force: true,
    filter: (source) => !shouldExclude(source, sourcePath),
  });
}

export async function writeBugPatch(repoPath: string, patchPath: string): Promise<void> {
  const trackedPatch = await getGitOutput(repoPath, ["diff", "--binary"]);
  const untrackedPatch = await buildUntrackedPatch(repoPath);
  const patch = [trackedPatch.trimEnd(), untrackedPatch.trimEnd()].filter(Boolean).join("\n\n");
  await writeFile(patchPath, patch ? `${patch}\n` : "", "utf8");
}

export async function prepareCandidateRepo(repoPath: string): Promise<void> {
  await restorePostSeedIgnoredFiles(repoPath);
  await rm(path.join(repoPath, "BUG_REPORT.md"), { force: true });
}

export async function restorePostSeedIgnoredFiles(repoPath: string): Promise<void> {
  const existingPaths = await getExistingGitPaths(repoPath, POST_SEED_RESTORE_PATHS);
  if (existingPaths.length === 0) {
    return;
  }

  await execFileAsync("git", ["-C", repoPath, "restore", "--source=HEAD", "--", ...existingPaths], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function buildUntrackedPatch(repoPath: string): Promise<string> {
  const stdout = await getGitOutput(repoPath, ["ls-files", "--others", "--exclude-standard"]);
  const files = stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("dist/"));

  const patches: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(path.join(repoPath, file), "utf8");
      const lineCount = content.length === 0 ? 0 : content.split("\n").length;
      const addedLines = content
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n");

      patches.push(
        [
          `diff --git a/${file} b/${file}`,
          "new file mode 100644",
          "index 0000000..0000000",
          "--- /dev/null",
          `+++ b/${file}`,
          `@@ -0,0 +1,${lineCount} @@`,
          addedLines,
        ].join("\n"),
      );
    } catch {
      continue;
    }
  }

  return patches.join("\n\n");
}

async function getGitOutput(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

async function getExistingGitPaths(repoPath: string, pathsToCheck: string[]): Promise<string[]> {
  const existingPaths: string[] = [];

  for (const filePath of pathsToCheck) {
    try {
      await execFileAsync("git", ["-C", repoPath, "ls-files", "--error-unmatch", filePath], {
        maxBuffer: 1024 * 1024,
      });
      existingPaths.push(filePath);
    } catch {
      continue;
    }
  }

  return existingPaths;
}

function shouldExclude(sourcePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, sourcePath);
  if (!relativePath) {
    return false;
  }

  return relativePath.split(path.sep).some((part) => EXCLUDED_DIRS.has(part));
}
