# BugFarm POC

BugFarm is an HTTP-triggered Node.js/TypeScript service that uses the Cursor SDK to seed realistic, non-malicious bugs into a local Git repository or a temporary clone of a GitHub repository. It is intended for evaluating AI coding agents on real codebases.

## Requirements

- Node.js 22+
- npm
- A Cursor API key
- A local Git repository to mutate, or a GitHub repository URL/path to clone

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set your Cursor API key in `.env`:

```bash
CURSOR_API_KEY=your_cursor_api_key_here
MODEL_NAME=default
PORT=3000
ASSESSMENT_OUTPUT_DIR=./artifacts
```

## Scripts

```bash
npm run dev
npm run build
npm start
```

`npm run dev` starts the TypeScript service with `tsx`.

`npm run build` compiles the service to `dist/`.

`npm start` runs the compiled service from `dist/index.js`.

## API

Interactive API docs are available through Scalar:

```text
http://localhost:3000/docs
```

The OpenAPI document is available at:

```text
http://localhost:3000/openapi.json
```

### Health Check

```http
GET /health
```

Response:

```json
{ "status": "ok" }
```

### Seed Bug

```http
POST /seed-bug
```

Request:

```json
{
  "repoPath": "/absolute/path/to/repo",
  "area": "auth",
  "difficulty": "medium",
  "language": "typescript",
  "bugCount": 1
}
```

Only `repoPath` is required. It can be an absolute local path, a GitHub URL, an SSH GitHub URL, `github.com/owner/repo`, or `owner/repo`.

`bugCount` is optional, defaults to `1`, and must be an integer from `1` to `10`.

GitHub repositories are cloned into a temporary local directory under `/tmp`; BugFarm does not push changes back to GitHub.

Example:

```bash
curl -X POST http://localhost:3000/seed-bug \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/absolute/path/to/sample-repo",
    "area": "auth",
    "difficulty": "medium",
    "language": "typescript",
    "bugCount": 1
  }'
```

GitHub shorthand example:

```bash
curl -X POST http://localhost:3000/seed-bug \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "owner/repo",
    "area": "auth",
    "difficulty": "medium",
    "language": "python",
    "bugCount": 2
  }'
```

Success response:

```json
{
  "status": "success",
  "requestedRepoPath": "owner/repo",
  "repoPath": "/tmp/bugfarm-abcd12/owner-repo",
  "repoSource": "github",
  "summary": "Seeded a realistic intentional bug",
  "difficulty": "medium",
  "bugCount": 1,
  "filesChanged": ["src/auth/session.ts", "BUG_REPORT.md"],
  "bugReportPath": "/tmp/bugfarm-abcd12/owner-repo/BUG_REPORT.md"
}
```

### Generate Assessment

```http
POST /generate-assessment
```

Request:

```json
{
  "repoPath": "owner/repo",
  "area": "auth",
  "difficulty": "medium",
  "language": "typescript",
  "bugCount": 1,
  "role": "backend engineer",
  "assessmentName": "Backend Debugging Screen"
}
```

This endpoint creates a local assessment artifact under `ASSESSMENT_OUTPUT_DIR`.

Success response:

```json
{
  "status": "success",
  "assessmentId": "backend-debugging-screen-20260504094530-a1b2c3d4",
  "assessmentName": "Backend Debugging Screen",
  "artifactPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4",
  "candidateRepoPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/candidate-repo",
  "baselineRepoPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/baseline-repo",
  "hiddenTestsPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/hidden-tests",
  "validation": {
    "status": "passed",
    "ecosystem": "node"
  },
  "filesChanged": ["src/auth/session.ts", "BUG_REPORT.md"],
  "summary": "Seeded a realistic intentional bug",
  "difficulty": "medium",
  "bugCount": 1,
  "bugReportPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/reports/BUG_REPORT.md",
  "taskPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/candidate/TASK.md",
  "patchPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/patches/bug.patch",
  "rubricPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/rubric.json"
}
```

Artifact layout:

```text
artifacts/<assessmentId>/
  assessment.json
  baseline-repo/
  candidate-repo/
  hidden-tests/
  reports/BUG_REPORT.md
  patches/bug.patch
  candidate/TASK.md
  rubric.json
```

`baseline-repo/` is the original repo snapshot. `candidate-repo/` is the bugged repo a candidate should fix. `candidate/TASK.md` is candidate-facing and avoids directly revealing the seeded bug.

For v1, hidden test validation supports TypeScript/Node and Python repositories when a test runner is detectable. Node validation uses `npm test`. Python validation uses `python -m pytest`. If no supported runner is detected, validation is marked `skipped` with a reason.

Error response:

```json
{
  "status": "error",
  "message": "Repo path does not exist"
}
```

## How It Works

For `/seed-bug`:

1. Resolves the requested repository path, cloning GitHub inputs into `/tmp`.
2. Loads the prompt from `prompts/seed-bug.md`.
3. Scans the target repo for a compact file tree and selected source snippets.
4. Sends the assembled prompt to Cursor SDK with the target repo as the working directory.
5. Reads changed files from Git.
6. Confirms `BUG_REPORT.md` exists.
7. Returns a structured JSON response.

For `/generate-assessment`:

1. Resolves the requested repository path.
2. Copies the original repo into `baseline-repo/`.
3. Copies the baseline into `candidate-repo/`.
4. Runs the bug seeder against `candidate-repo/`.
5. Writes `BUG_REPORT.md`, `TASK.md`, `rubric.json`, `bug.patch`, hidden test harness files, and `assessment.json`.
6. Runs validation when a supported test command is detected.

## Notes

- BugFarm intentionally edits the target repository. Use a disposable branch or sample repo when testing.
- The prompt instructs Cursor to introduce the requested number of realistic bugs and to avoid malicious, destructive, or hidden behavior.
- Supported source extensions for scan context are `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, and `.sol`.
