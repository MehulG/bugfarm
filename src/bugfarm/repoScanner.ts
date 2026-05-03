import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".wasm",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".sol",
]);

export type RepoScan = {
  fileTree: string;
  sourceContext: string;
  files: string[];
};

type WalkEntry = {
  absolutePath: string;
  relativePath: string;
  isDirectory: boolean;
};

export async function verifyRepoPath(repoPath: string): Promise<string> {
  const absolutePath = path.resolve(repoPath);

  try {
    await access(absolutePath, constants.R_OK);
  } catch {
    throw new Error("Repo path does not exist");
  }

  const stats = await stat(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error("Repo path is not a directory");
  }

  return absolutePath;
}

export async function scanRepo(repoPath: string): Promise<RepoScan> {
  const root = await verifyRepoPath(repoPath);
  const entries = await walkRepo(root);
  const visibleFiles = entries.filter((entry) => !entry.isDirectory);
  const sourceFiles = visibleFiles.filter((entry) => isSourceFile(entry.relativePath));
  const fileTree = buildFileTree(entries);
  const selectedSourceFiles = sourceFiles.slice(0, config.repoScanMaxFiles);
  const sourceContext = await buildSourceContext(selectedSourceFiles, config.repoScanMaxChars);

  return {
    fileTree,
    sourceContext,
    files: sourceFiles.map((entry) => entry.relativePath),
  };
}

async function walkRepo(root: string): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = [];

  async function walk(currentPath: string): Promise<void> {
    const dirents = await readdir(currentPath, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      const absolutePath = path.join(currentPath, dirent.name);
      const relativePath = path.relative(root, absolutePath);

      if (shouldIgnore(relativePath, dirent.isDirectory())) {
        continue;
      }

      if (!dirent.isDirectory() && !dirent.isFile()) {
        continue;
      }

      entries.push({
        absolutePath,
        relativePath,
        isDirectory: dirent.isDirectory(),
      });

      if (dirent.isDirectory()) {
        await walk(absolutePath);
      }
    }
  }

  await walk(root);
  return entries;
}

function shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
  const name = path.basename(relativePath);
  const extension = path.extname(name).toLowerCase();

  if (isDirectory) {
    return IGNORED_DIRS.has(name);
  }

  return IGNORED_FILES.has(name) || IGNORED_EXTENSIONS.has(extension);
}

function isSourceFile(relativePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function buildFileTree(entries: WalkEntry[]): string {
  if (entries.length === 0) {
    return "(empty repository)";
  }

  return entries
    .map((entry) => {
      const depth = entry.relativePath.split(path.sep).length - 1;
      const indent = "  ".repeat(depth);
      const name = path.basename(entry.relativePath);
      return `${indent}${entry.isDirectory ? `${name}/` : name}`;
    })
    .join("\n");
}

async function buildSourceContext(files: WalkEntry[], maxChars: number): Promise<string> {
  let remainingChars = maxChars;
  const snippets: string[] = [];

  for (const file of files) {
    if (remainingChars <= 0) {
      break;
    }

    const raw = await readFile(file.absolutePath, "utf8");
    const budgetForFile = Math.max(0, remainingChars - file.relativePath.length - 32);
    const content = raw.length > budgetForFile ? raw.slice(0, budgetForFile) : raw;
    const truncated = raw.length > content.length ? "\n...<truncated>" : "";
    const snippet = `--- ${file.relativePath} ---\n${content}${truncated}`;

    snippets.push(snippet);
    remainingChars -= snippet.length;
  }

  return snippets.length > 0 ? snippets.join("\n\n") : "(no supported source files found)";
}
