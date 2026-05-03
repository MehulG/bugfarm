import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getChangedFiles(repoPath: string): Promise<string[]> {
  try {
    const [diffResult, untrackedResult] = await Promise.all([
      execFileAsync("git", ["-C", repoPath, "diff", "--name-only"], {
        maxBuffer: 1024 * 1024,
      }),
      execFileAsync("git", ["-C", repoPath, "ls-files", "--others", "--exclude-standard"], {
        maxBuffer: 1024 * 1024,
      }),
    ]);

    return `${diffResult.stdout}\n${untrackedResult.stdout}`
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file, index, files) => files.indexOf(file) === index);
  } catch {
    return [];
  }
}
