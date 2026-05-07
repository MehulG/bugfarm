import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cloneRepo } from "./git.js";
import { verifyRepoPath } from "./repoScanner.js";

export type RepoTarget = {
  requestedRepoPath: string;
  repoPath: string;
  repoSource: "local" | "github";
};

type GitHubRepo = {
  owner: string;
  repo: string;
  cloneUrl: string;
};

export async function resolveRepoTarget(repoPath: string): Promise<RepoTarget> {
  const requestedRepoPath = repoPath.trim();
  const localPath = await resolveLocalRepoPath(requestedRepoPath);

  if (localPath) {
    return {
      requestedRepoPath,
      repoPath: localPath,
      repoSource: "local",
    };
  }

  const githubRepo = parseGitHubRepo(requestedRepoPath);
  if (!githubRepo) {
    throw new Error("Repo path does not exist or is not a supported GitHub repo path");
  }

  const cloneRoot = await mkdtemp(path.join(os.tmpdir(), "codesheep-"));
  const destinationPath = path.join(cloneRoot, `${githubRepo.owner}-${githubRepo.repo}`);

  try {
    await cloneRepo({
      cloneUrl: githubRepo.cloneUrl,
      destinationPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown git clone error";
    throw new Error(`Failed to clone GitHub repo: ${message}`);
  }

  return {
    requestedRepoPath,
    repoPath: await verifyRepoPath(destinationPath),
    repoSource: "github",
  };
}

async function resolveLocalRepoPath(repoPath: string): Promise<string | undefined> {
  const absolutePath = path.resolve(repoPath);

  try {
    const stats = await stat(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error("Repo path is not a directory");
    }

    return verifyRepoPath(absolutePath);
  } catch (error) {
    if (error instanceof Error && error.message === "Repo path is not a directory") {
      throw error;
    }

    return undefined;
  }
}

function parseGitHubRepo(input: string): GitHubRepo | undefined {
  const normalizedInput = input.trim();
  const sshMatch = normalizedInput.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);

  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: stripGitSuffix(sshMatch[2]),
      cloneUrl: normalizedInput,
    };
  }

  const urlRepo = parseGitHubUrl(normalizedInput);
  if (urlRepo) {
    return urlRepo;
  }

  const shorthandMatch = normalizedInput.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!shorthandMatch || normalizedInput.startsWith(".") || normalizedInput.startsWith("~")) {
    return undefined;
  }

  const owner = shorthandMatch[1];
  const repo = stripGitSuffix(shorthandMatch[2]);

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function parseGitHubUrl(input: string): GitHubRepo | undefined {
  let url: URL;

  try {
    url = new URL(input.startsWith("github.com/") ? `https://${input}` : input);
  } catch {
    return undefined;
  }

  if (url.hostname !== "github.com") {
    return undefined;
  }

  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo) {
    return undefined;
  }

  const repo = stripGitSuffix(rawRepo);

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}
