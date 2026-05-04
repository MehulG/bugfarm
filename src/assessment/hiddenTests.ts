import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AssessmentValidation, AssessmentValidationRun } from "./types.js";

const execFileAsync = promisify(execFile);

export async function createAndValidateHiddenTests(input: {
  baselineRepoPath: string;
  candidateRepoPath: string;
  hiddenTestsPath: string;
  language?: string;
}): Promise<AssessmentValidation> {
  const ecosystem = await detectEcosystem(input.baselineRepoPath, input.language);
  await writeHiddenHarness(input.hiddenTestsPath, ecosystem);

  if (ecosystem === "unknown") {
    const run = skippedRun("No supported Node or Python test runner was detected.");
    return {
      status: "skipped",
      ecosystem,
      hiddenTestsPath: input.hiddenTestsPath,
      baseline: { ...run, target: "baseline" },
      candidate: { ...run, target: "candidate" },
      notes: ["Hidden test harness was written, but validation was skipped."],
    };
  }

  const baseline = await runValidation(input.baselineRepoPath, "baseline", ecosystem);
  const candidate = await runValidation(input.candidateRepoPath, "candidate", ecosystem);
  const status = getValidationStatus(baseline, candidate);

  return {
    status,
    ecosystem,
    hiddenTestsPath: input.hiddenTestsPath,
    baseline,
    candidate,
    notes: [
      "V1 hidden-test harness runs the repository's detected test command from outside the candidate repo.",
      "A strong generated assessment should pass on baseline and fail on candidate before a fix.",
    ],
  };
}

async function detectEcosystem(
  repoPath: string,
  language?: string,
): Promise<AssessmentValidation["ecosystem"]> {
  const normalizedLanguage = language?.toLowerCase();

  if (normalizedLanguage?.includes("python")) {
    return (await hasPythonSignals(repoPath)) ? "python" : "unknown";
  }

  if (
    normalizedLanguage?.includes("type") ||
    normalizedLanguage?.includes("javascript") ||
    normalizedLanguage?.includes("node")
  ) {
    return (await hasNodeTestScript(repoPath)) ? "node" : "unknown";
  }

  if (await hasNodeTestScript(repoPath)) {
    return "node";
  }

  if (await hasPythonSignals(repoPath)) {
    return "python";
  }

  return "unknown";
}

async function writeHiddenHarness(
  hiddenTestsPath: string,
  ecosystem: AssessmentValidation["ecosystem"],
): Promise<void> {
  await mkdir(hiddenTestsPath, { recursive: true });

  await writeFile(
    path.join(hiddenTestsPath, "README.md"),
    `# Hidden Tests

These files are stored outside the candidate repository.

For v1, the hidden harness runs the detected repository test command against a supplied repository path. Assessment validation expects the baseline repo to pass and the candidate repo to fail before the candidate fix.
`,
    "utf8",
  );

  if (ecosystem === "node") {
    await writeFile(
      path.join(hiddenTestsPath, "run-hidden-tests.mjs"),
      `import { spawnSync } from "node:child_process";

const repoPath = process.argv[2];
if (!repoPath) {
  console.error("Usage: node run-hidden-tests.mjs /path/to/repo");
  process.exit(2);
}

const result = spawnSync("npm", ["test"], {
  cwd: repoPath,
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
`,
      "utf8",
    );
  } else if (ecosystem === "python") {
    await writeFile(
      path.join(hiddenTestsPath, "run-hidden-tests.py"),
      `import subprocess
import sys

if len(sys.argv) != 2:
    print("Usage: python run-hidden-tests.py /path/to/repo", file=sys.stderr)
    raise SystemExit(2)

raise SystemExit(subprocess.run([sys.executable, "-m", "pytest"], cwd=sys.argv[1]).returncode)
`,
      "utf8",
    );
  } else {
    await writeFile(
      path.join(hiddenTestsPath, "hidden-test-spec.md"),
      "No supported test runner was detected. Add generated hidden test cases here when an ecosystem-specific generator is available.\n",
      "utf8",
    );
  }
}

async function runValidation(
  repoPath: string,
  target: AssessmentValidationRun["target"],
  ecosystem: "node" | "python",
): Promise<AssessmentValidationRun> {
  const testCommand = await resolveTestCommand(repoPath, ecosystem);
  if (!testCommand) {
    return {
      target,
      status: "skipped",
      reason:
        ecosystem === "python"
          ? "Python project detected, but pytest is not installed in the available Python environment."
          : "Node project detected, but npm is not available.",
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(testCommand.executable, testCommand.args, {
      cwd: repoPath,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });

    return {
      target,
      status: "passed",
      command: testCommand.label,
      exitCode: 0,
      output: trimOutput(`${stdout}\n${stderr}`),
    };
  } catch (error) {
    const execError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    return {
      target,
      status: "failed",
      command: testCommand.label,
      exitCode: typeof execError.code === "number" ? execError.code : undefined,
      output: trimOutput(`${execError.stdout || ""}\n${execError.stderr || ""}`),
      reason: execError.killed ? "Validation command timed out." : undefined,
    };
  }
}

async function resolveTestCommand(
  repoPath: string,
  ecosystem: "node" | "python",
): Promise<{ executable: string; args: string[]; label: string } | undefined> {
  if (ecosystem === "node") {
    try {
      await execFileAsync("npm", ["--version"], {
        cwd: repoPath,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      return {
        executable: "npm",
        args: ["test"],
        label: "npm test",
      };
    } catch {
      return undefined;
    }
  }

  const python = await resolvePythonWithPytest(repoPath);
  if (!python) {
    return undefined;
  }

  return {
    executable: python,
    args: ["-m", "pytest"],
    label: `${python} -m pytest`,
  };
}

async function resolvePythonWithPytest(repoPath: string): Promise<string | undefined> {
  const candidates = [
    path.join(repoPath, ".venv", "bin", "python"),
    path.join(repoPath, "venv", "bin", "python"),
    "python3",
    "python",
  ];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !(await pathExists(candidate))) {
      continue;
    }

    try {
      await execFileAsync(candidate, ["-m", "pytest", "--version"], {
        cwd: repoPath,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getValidationStatus(
  baseline: AssessmentValidationRun,
  candidate: AssessmentValidationRun,
): AssessmentValidation["status"] {
  if (baseline.status === "skipped" || candidate.status === "skipped") {
    return "skipped";
  }

  return baseline.status === "passed" && candidate.status === "failed" ? "passed" : "failed";
}

function skippedRun(reason: string): Omit<AssessmentValidationRun, "target"> {
  return {
    status: "skipped",
    reason,
  };
}

async function hasNodeTestScript(repoPath: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(repoPath, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const testScript = packageJson.scripts?.test;
    return Boolean(testScript && !testScript.includes("no test specified"));
  } catch {
    return false;
  }
}

async function hasPythonSignals(repoPath: string): Promise<boolean> {
  if (
    (await pathExists(path.join(repoPath, "pytest.ini"))) ||
    (await pathExists(path.join(repoPath, "pyproject.toml"))) ||
    (await pathExists(path.join(repoPath, "setup.cfg")))
  ) {
    return true;
  }

  try {
    const entries = await readdir(path.join(repoPath, "tests"));
    return entries.some((entry) => entry.endsWith(".py"));
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function trimOutput(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= 12000) {
    return trimmed;
  }

  return `${trimmed.slice(0, 12000)}\n...<truncated>`;
}
