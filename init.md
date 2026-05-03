# One-pager for Codex: BugFarm POC using Cursor SDK

## Goal

Build a first POC called **BugFarm**: an HTTP-triggered Node.js/TypeScript service that uses **Cursor SDK** to intentionally seed one realistic, non-malicious bug into a local Git repository.

This is for evaluating AI coding agents on real repos.

---

## Core Requirements

Use:

```bash
npm
typescript
express
dotenv
@cursor/sdk
```

The service must be called by HTTP request.

The prompt must live in a separate file.

Model/config values must come from env vars.

Code must be modular.

---

## Project Structure

```text
bugfarm-poc/
  package.json
  tsconfig.json
  .env.example
  prompts/
    seed-bug.md
  src/
    index.ts
    server.ts
    config.ts
    cursor/
      client.ts
    bugfarm/
      seedBug.ts
      repoScanner.ts
      git.ts
      types.ts
    utils/
      logger.ts
```

---

## Env Config

Create `.env.example`:

Load env in `src/config.ts`.

---

## Prompt File

Create `prompts/seed-bug.md`:

```text
You are BugFarm, a repo bug-seeding agent for AI coding-agent evaluation.

Introduce exactly one realistic intentional bug into this repository.

Rules:
- Only modify source/application code.
- Do not modify tests.
- Do not delete files.
- Do not introduce malware, data exfiltration, persistence, credential theft, auth bypasses, or destructive behavior.
- Do not hide your changes.
- The project should still compile if possible.
- Prefer realistic logic bugs, validation bugs, edge-case bugs, state bugs, race-condition-like bugs, or off-by-one bugs.
- Keep the change minimal.
- Create a BUG_REPORT.md file at repo root.

BUG_REPORT.md must include:
1. Bug summary
2. Files changed
3. Reproduction steps
4. Expected vs actual behavior
5. Difficulty: easy | medium | hard
6. Suggested test that should catch the bug

Return a final JSON object in your last message:
{
  "summary": string,
  "difficulty": "easy" | "medium" | "hard",
  "filesChanged": string[],
  "bugReportPath": "BUG_REPORT.md"
}
```

---

## HTTP API

Implement:

```text
POST /seed-bug
```

Request:

```json
{
  "repoPath": "/absolute/path/to/repo",
  "area": "auth",
  "difficulty": "medium",
  "language": "typescript"
}
```

Only `repoPath` is required.

Response:

```json
{
  "status": "success",
  "repoPath": "/absolute/path/to/repo",
  "summary": "Introduced a realistic token expiry edge-case bug",
  "difficulty": "medium",
  "filesChanged": ["src/auth/session.ts", "BUG_REPORT.md"],
  "bugReportPath": "/absolute/path/to/repo/BUG_REPORT.md"
}
```

Error:

```json
{
  "status": "error",
  "message": "Repo path does not exist"
}
```

---

## Cursor SDK Client

Create `src/cursor/client.ts`.

It should expose:

```ts
import { Agent } from "@cursor/sdk";

export async function runCursorAgent(input: {
  repoPath: string;
  prompt: string;
  model?: string;
}): Promise<string> {
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY!,
    model: {
      id: input.model || process.env.MODEL_NAME || "cursor-fast",
    },
    local: {
      cwd: input.repoPath,
    },
  });

  const run = await agent.send(input.prompt);

  let output = "";

  for await (const event of run.stream()) {
    output += JSON.stringify(event) + "\n";
  }

  return output;
}
```

Cursor SDK must be the primary execution path. Do not implement raw OpenAI calls for the first POC.

---

## Repo Scanner

Create `src/bugfarm/repoScanner.ts`.

It should:

* verify repo path exists
* collect a compact file tree
* optionally include small source file snippets
* ignore:

  * `.git`
  * `node_modules`
  * `dist`
  * `build`
  * `.next`
  * `coverage`
  * lock files
  * binaries/images

Supported source extensions:

```text
.ts, .tsx, .js, .jsx, .py, .go, .rs, .java, .sol
```

Limit context to avoid huge prompts, for example max 40 files or 150k chars.

---

## Git Helper

Create `src/bugfarm/git.ts`.

Expose:

```ts
export async function getChangedFiles(repoPath: string): Promise<string[]>
```

Implementation can shell out to:

```bash
git diff --name-only
```

This is used after Cursor SDK finishes editing.

---

## Main Seeder Flow

Create `src/bugfarm/seedBug.ts`.

Flow:

1. Validate `repoPath`.
2. Load `prompts/seed-bug.md`.
3. Scan repo using `repoScanner`.
4. Build final prompt with:

   * base prompt
   * repo file tree
   * selected source context
   * requested area
   * requested difficulty
   * requested language
5. Call `runCursorAgent`.
6. Use `git diff --name-only` to detect changed files.
7. Confirm `BUG_REPORT.md` exists.
8. Parse final JSON from agent output if possible.
9. Return structured API response.

---

## Types

Create `src/bugfarm/types.ts`:

```ts
export type SeedBugRequest = {
  repoPath: string;
  area?: string;
  difficulty?: "easy" | "medium" | "hard";
  language?: string;
};

export type SeedBugSuccess = {
  status: "success";
  repoPath: string;
  summary: string;
  difficulty: string;
  filesChanged: string[];
  bugReportPath: string;
};

export type SeedBugError = {
  status: "error";
  message: string;
};
```

---

## Server

`src/server.ts` should create an Express server.

Routes:

```text
GET /health
POST /seed-bug
```

`GET /health` returns:

```json
{ "status": "ok" }
```

`POST /seed-bug` calls `seedBug()` and returns JSON.

`src/index.ts` should start the server.

---

## Package Scripts

`package.json` should include:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

Install needed deps:

```bash
npm install express dotenv @cursor/sdk
npm install -D typescript tsx @types/node @types/express
```

---

## Acceptance Criteria

The POC is done when:

1. `npm install` works.
2. `.env.example` exists.
3. Prompt is in `prompts/seed-bug.md`.
4. Server starts with `npm run dev`.
5. `GET /health` works.
6. `POST /seed-bug` accepts a local repo path.
7. Cursor SDK is used to edit the repo.
8. At least one source file is changed.
9. `BUG_REPORT.md` is created.
10. Response returns changed files, summary, and bug report path.

---

## Test Command

```bash
curl -X POST http://localhost:3000/seed-bug \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/absolute/path/to/sample-repo",
    "area": "auth",
    "difficulty": "medium",
    "language": "typescript"
  }'
```
