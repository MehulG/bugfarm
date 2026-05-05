import test from "node:test";
import assert from "node:assert/strict";
import { buildBugReportRepairPrompt } from "../bugfarm/seedBug.js";

test("buildBugReportRepairPrompt asks for report-only recovery", () => {
  const prompt = buildBugReportRepairPrompt({
    repoPath: "/tmp/repo",
    difficulty: "medium",
    bugCount: 2,
    filesChanged: ["src/auth.ts", "src/session.ts"],
    previousFinalJson: {
      summary: "Seeded auth bugs",
      difficulty: "medium",
      bugCount: 2,
      filesChanged: ["src/auth.ts", "src/session.ts"],
      bugReportPath: "BUG_REPORT.md",
    },
  });

  assert.match(prompt, /Create BUG_REPORT\.md at the repository root/);
  assert.match(prompt, /Inspect the current git diff and changed files/);
  assert.match(prompt, /Do not modify source code unless it is absolutely required/);
  assert.match(prompt, /src\/auth\.ts/);
  assert.match(prompt, /"bugReportPath": "BUG_REPORT.md"/);
});
