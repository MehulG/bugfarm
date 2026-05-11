import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AssessmentValidation } from "../assessment/types.js";
import {
  generateOrchestratedAssessment,
  isForbiddenChangedFile,
  isTriviallySolved,
  parseJsonObject,
  proposeBugDesigns,
} from "../assessment/orchestration.js";

const execFileAsync = promisify(execFile);

test("parseJsonObject extracts structured JSON from Cursor-style event output", () => {
  const parsed = parseJsonObject(
    [
      JSON.stringify({ text: "thinking..." }),
      JSON.stringify({ output: '{"accepted":true,"score":82,"reasons":["good"],"risks":[]}' }),
    ].join("\n"),
  );

  assert.deepEqual(parsed, {
    accepted: true,
    score: 82,
    reasons: ["good"],
    risks: [],
  });
});

test("parseJsonObject extracts nested Cursor SDK message text", () => {
  const parsed = parseJsonObject(
    JSON.stringify({
      type: "message",
      message: {
        content: [
          {
            type: "text",
            text: '```json\n{"designs":[{"title":"Boundary regression","target_files":["src/app.ts"]}]}\n```',
          },
        ],
      },
    }),
  );

  assert.deepEqual(parsed, {
    designs: [{ title: "Boundary regression", target_files: ["src/app.ts"] }],
  });
});

test("proposeBugDesigns tolerates alternate design field names", async () => {
  const designs = await proposeBugDesigns({
    repoPath: "/tmp/repo",
    difficulty: "hard",
    bugCount: 1,
    designCount: 1,
    bugDiversification: true,
    profile: {
      workflows: [],
      highValueTargets: [],
      edgeCases: [],
      testableEntryPoints: [],
    },
    fileTree: "src/app.ts",
    sourceContext: "export const value = 1;",
    runCursorAgent: async () =>
      JSON.stringify({
        type: "message",
        message: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                candidates: [
                  {
                    name: "Boundary regression",
                    files: ["src/app.ts"],
                    expectedFailureMode: "rejects a valid boundary case",
                    hiddenTests: ["exercise boundary input"],
                  },
                ],
              }),
            },
          ],
        },
      }),
  });

  assert.deepEqual(designs, [
    {
      id: "boundary-regression",
      title: "Boundary regression",
      category: "logic",
      difficulty: "hard",
      targetFiles: ["src/app.ts"],
      behaviorChange: "rejects a valid boundary case",
      whyRealistic: "",
      hiddenTestStrategy: ["exercise boundary input"],
      risk: "medium",
    },
  ]);
});

test("proposeBugDesigns reconstructs split Cursor text chunks", async () => {
  const chunks = [
    JSON.stringify({ type: "message", delta: "{\"candidates\":[" }),
    JSON.stringify({ type: "message", delta: "{\"name\":\"Chunked regression\"," }),
    JSON.stringify({ type: "message", delta: "\"files\":[\"src/queue.ts\"]," }),
    JSON.stringify({ type: "message", delta: "\"expectedFailureMode\":\"drops queued jobs\"}" }),
    JSON.stringify({ type: "message", delta: "]}" }),
  ].join("\n");

  const designs = await proposeBugDesigns({
    repoPath: "/tmp/repo",
    difficulty: "medium",
    bugCount: 1,
    designCount: 1,
    bugDiversification: true,
    profile: {
      workflows: [],
      highValueTargets: [],
      edgeCases: [],
      testableEntryPoints: [],
    },
    fileTree: "src/queue.ts",
    sourceContext: "export function enqueue() {}",
    runCursorAgent: async () => chunks,
  });

  assert.equal(designs[0].title, "Chunked regression");
  assert.deepEqual(designs[0].targetFiles, ["src/queue.ts"]);
});

test("proposeBugDesigns reports a useful preview when no JSON design is found", async () => {
  await assert.rejects(
    proposeBugDesigns({
      repoPath: "/tmp/repo",
      difficulty: "medium",
      bugCount: 1,
      designCount: 1,
      bugDiversification: true,
      profile: {
        workflows: [],
        highValueTargets: [],
        edgeCases: [],
        testableEntryPoints: [],
      },
      fileTree: "src/app.ts",
      sourceContext: "export const value = 1;",
      runCursorAgent: async () => "I cannot produce JSON for this repository.",
    }),
    /Bug design orchestration did not produce any valid designs/,
  );
});

test("orchestration gates reject forbidden files and trivial solver results", () => {
  assert.equal(isForbiddenChangedFile("src/app.ts"), false);
  assert.equal(isForbiddenChangedFile("package.json"), true);
  assert.equal(isForbiddenChangedFile(".github/workflows/ci.yml"), true);
  assert.equal(isForbiddenChangedFile("src/app.test.ts"), true);

  assert.equal(
    isTriviallySolved({
      attempted: true,
      solved: true,
      hiddenScore: 100,
      filesInspected: 2,
      changedFiles: ["src/app.ts"],
      summary: "easy",
      tooEasy: true,
    }),
    true,
  );
});

test("generateOrchestratedAssessment selects a validated source-only design", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "codesheep-orchestrate-repo-"));
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "codesheep-orchestrate-artifacts-"));
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(repo, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "Codesheep Test"]);
  await git(repo, ["config", "user.email", "test@codesheep.local"]);
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "initial"]);

  const result = await generateOrchestratedAssessment(
    {
      repoPath: repo,
      assessmentName: "Orchestrated Test",
      difficulty: "medium",
      adversarialSolver: false,
      designCount: 2,
      seedAttemptCount: 2,
    },
    {
      runCursorAgent: async ({ repoPath, prompt }) => {
        if (prompt.includes("repo profiler")) {
          return JSON.stringify({
            workflows: ["value calculation"],
            highValueTargets: ["src/app.ts"],
            edgeCases: ["zero value"],
            testableEntryPoints: ["src/app.ts"],
          });
        }
        if (prompt.includes("bug-design agent")) {
          return JSON.stringify({
            designs: [
              {
                id: "bad-manifest",
                title: "Bad manifest change",
                category: "config",
                difficulty: "medium",
                targetFiles: ["package.json"],
                behaviorChange: "change manifest",
                whyRealistic: "not acceptable",
                hiddenTestStrategy: ["none"],
                risk: "high",
              },
              {
                id: "good-source",
                title: "Source logic regression",
                category: "logic",
                difficulty: "medium",
                targetFiles: ["src/app.ts"],
                behaviorChange: "return a different value",
                whyRealistic: "small logic mistake",
                hiddenTestStrategy: ["import value"],
                risk: "low",
              },
            ],
          });
        }
        if (prompt.includes("selected bug seeding agent")) {
          if (prompt.includes("bad-manifest")) {
            await writeFile(path.join(repoPath, "package.json"), "{\"name\":\"bad\"}\n", "utf8");
          } else {
            await writeFile(path.join(repoPath, "src", "app.ts"), "export const value = 2;\n", "utf8");
          }
          await writeFile(path.join(repoPath, "BUG_REPORT.md"), "Bug report\n", "utf8");
          return JSON.stringify({
            summary: "Seeded bug",
            difficulty: "medium",
            bugCount: 1,
            filesChanged: prompt.includes("bad-manifest") ? ["package.json"] : ["src/app.ts"],
            bugReportPath: "BUG_REPORT.md",
          });
        }
        if (prompt.includes("assignment quality judge")) {
          return JSON.stringify({
            accepted: true,
            score: 85,
            reasons: ["clean deterministic assignment"],
            risks: [],
          });
        }
        throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
      },
      createAndValidateHiddenTests: async () => passedValidation(),
      createCandidateLaunchForAssessment: async ({ assessmentId }) => ({
        record: {} as never,
        launchToken: "launch-token",
        candidateLaunchUrl: `https://example.test/candidate/launch/${assessmentId}`,
      }),
      createArtifactPaths: async (assessmentName) => {
        const safeName = (assessmentName || "assessment").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const artifactPath = path.join(artifactRoot, `${safeName}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const baselineRepoPath = path.join(artifactPath, "baseline-repo");
        const candidateRepoPath = path.join(artifactPath, "candidate-repo");
        const hiddenTestsPath = path.join(artifactPath, "hidden-tests");
        const reportsPath = path.join(artifactPath, "reports");
        const patchesPath = path.join(artifactPath, "patches");
        const candidatePath = path.join(artifactPath, "candidate");
        await Promise.all([
          mkdir(baselineRepoPath, { recursive: true }),
          mkdir(candidateRepoPath, { recursive: true }),
          mkdir(hiddenTestsPath, { recursive: true }),
          mkdir(reportsPath, { recursive: true }),
          mkdir(patchesPath, { recursive: true }),
          mkdir(candidatePath, { recursive: true }),
        ]);
        return {
          assessmentId: path.basename(artifactPath),
          artifactPath,
          baselineRepoPath,
          candidateRepoPath,
          hiddenTestsPath,
          reportsPath,
          patchesPath,
          candidatePath,
          bugReportPath: path.join(reportsPath, "BUG_REPORT.md"),
          taskPath: path.join(candidatePath, "TASK.md"),
          patchPath: path.join(patchesPath, "bug.patch"),
          rubricPath: path.join(artifactPath, "rubric.json"),
          assessmentJsonPath: path.join(artifactPath, "assessment.json"),
        };
      },
    },
  );

  assert.equal(result.status, "success");
  assert.equal(result.orchestration?.selectedDesign?.id, "good-source");
  assert.deepEqual(result.filesChanged, ["src/app.ts"]);
  assert.equal(await readFile(path.join(result.candidateRepoPath, "src", "app.ts"), "utf8"), "export const value = 2;\n");
  assert.match(result.candidateLaunchUrl, /candidate\/launch/);
});

function passedValidation(): AssessmentValidation {
  return {
    status: "passed",
    ecosystem: "node",
    hiddenTestsPath: "/tmp/hidden-tests",
    retryCount: 1,
    wrapperEntrypoints: ["hidden-tests/wrapper.js"],
    targetSymbols: ["value"],
    baseline: {
      target: "baseline",
      status: "passed",
    },
    candidate: {
      target: "candidate",
      status: "failed",
    },
    notes: ["mock validation"],
  };
}

async function git(repo: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", repo, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
}
