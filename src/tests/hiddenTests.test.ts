import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCaseResults,
  extractTargetSymbols,
  validateSpec,
  type HiddenTestSpec,
} from "../assessment/hiddenTests.js";

test("extractTargetSymbols keeps likely symbols and file-derived names", () => {
  const bugReport = `
Updated \`normalizeEmail\` and \`SessionStore\`.
Ignore file refs like \`src/auth.ts\` and \`memory.py\`.
`;

  const symbols = extractTargetSymbols(bugReport, [
    "src/auth/session.ts",
    "tradingagents/agents/memory.py",
  ]);

  assert.deepEqual(symbols, [
    "normalizeEmail",
    "SessionStore",
    "session",
    "memory",
  ]);
});

test("validateSpec rejects invalid wrapper and duplicate ids", () => {
  const badWrapper: HiddenTestSpec = {
    ecosystem: "python",
    wrapper: {
      kind: "node",
      path: "hidden-tests/generated-wrapper.mjs",
    },
    cases: [
      {
        id: "same",
        category: "control",
        description: "control",
        input: {},
      },
      {
        id: "same",
        category: "exposes_bug",
        description: "exposes",
        input: {},
      },
    ],
  };

  assert.equal(
    validateSpec(badWrapper),
    "Hidden test spec wrapper kind must match ecosystem.",
  );

  const duplicateIds: HiddenTestSpec = {
    ecosystem: "node",
    wrapper: {
      kind: "node",
      path: "hidden-tests/generated-wrapper.mjs",
    },
    cases: [
      {
        id: "same",
        category: "control",
        description: "control",
        input: {},
      },
      {
        id: "same",
        category: "exposes_bug",
        description: "exposes",
        input: {},
      },
    ],
  };

  assert.equal(
    validateSpec(duplicateIds),
    "Each hidden test case id must be unique.",
  );
});

test("validateSpec accepts a minimal deterministic spec", () => {
  const spec: HiddenTestSpec = {
    ecosystem: "node",
    wrapper: {
      kind: "node",
      path: "hidden-tests/generated-wrapper.mjs",
    },
    cases: [
      {
        id: "control-1",
        category: "control",
        description: "stable",
        input: { value: "MixedCase@Example.com" },
      },
      {
        id: "bug-1",
        category: "exposes_bug",
        description: "shows regression",
        input: { value: "SECOND@EXAMPLE.COM" },
      },
    ],
  };

  assert.equal(validateSpec(spec), undefined);
});

test("compareCaseResults passes only when control matches and exposes_bug diverges", () => {
  const spec: HiddenTestSpec = {
    ecosystem: "node",
    wrapper: {
      kind: "node",
      path: "hidden-tests/generated-wrapper.mjs",
    },
    cases: [
      {
        id: "control-1",
        category: "control",
        description: "stable",
        input: {},
      },
      {
        id: "bug-1",
        category: "exposes_bug",
        description: "regression",
        input: {},
      },
    ],
  };

  const passed = compareCaseResults(spec, [
    {
      caseId: "control-1",
      category: "control",
      matchedBaseline: true,
      output: "\"same\"",
    },
    {
      caseId: "bug-1",
      category: "exposes_bug",
      matchedBaseline: false,
      output: "\"different\"",
    },
  ]);

  assert.deepEqual(passed, {
    status: "passed",
    candidateStatus: "failed",
    reason: "Candidate repo diverged from baseline on bug-exposing cases as expected.",
  });

  const unchanged = compareCaseResults(spec, [
    {
      caseId: "control-1",
      category: "control",
      matchedBaseline: true,
      output: "\"same\"",
    },
    {
      caseId: "bug-1",
      category: "exposes_bug",
      matchedBaseline: true,
      output: "\"same\"",
    },
  ]);

  assert.deepEqual(unchanged, {
    status: "failed",
    candidateStatus: "passed",
    reason: "Candidate repo matched baseline for all bug-exposing cases.",
  });
});

test("compareCaseResults rejects incomplete execution", () => {
  const spec: HiddenTestSpec = {
    ecosystem: "python",
    wrapper: {
      kind: "python",
      path: "hidden-tests/generated-wrapper.py",
    },
    cases: [
      {
        id: "control-1",
        category: "control",
        description: "stable",
        input: {},
      },
      {
        id: "bug-1",
        category: "exposes_bug",
        description: "regression",
        input: {},
      },
    ],
  };

  assert.deepEqual(compareCaseResults(spec, [
    {
      caseId: "control-1",
      category: "control",
      matchedBaseline: true,
      output: "\"same\"",
    },
  ]), {
    status: "failed",
    candidateStatus: "failed",
    reason: "Hidden test execution did not cover every declared case.",
  });
});
