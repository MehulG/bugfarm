import test from "node:test";
import assert from "node:assert/strict";
import { validateSeedBugRequest } from "../codesheep/seedBug.js";

test("validateSeedBugRequest accepts the simple single-call bug generation shape", async () => {
  await assert.doesNotReject(
    validateSeedBugRequest({
      repoPath: "/tmp/repo",
      difficulty: "medium",
      language: "typescript",
      area: "auth",
      bugCount: 1,
    }),
  );
});

test("validateSeedBugRequest rejects invalid bug counts", async () => {
  await assert.rejects(
    validateSeedBugRequest({
      repoPath: "/tmp/repo",
      bugCount: 0,
    }),
    /bugCount must be between 1 and 10/,
  );
});
