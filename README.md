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
DATABASE_PATH=./bugfarm.sqlite
PUBLIC_BACKEND_URL=http://localhost:3000
CODER_URL=https://coder.yourdomain.com
CODER_API_URL=https://coder.yourdomain.com
CODER_API_TOKEN=your_coder_api_token_here
CODER_ORGANIZATION_ID=your_coder_organization_id_here
CODER_TEMPLATE_ID=your_coder_template_id_here
CODER_WORKSPACE_TTL_MS=14400000
AI_PROXY_ENABLED=true
AI_UPSTREAM_BASE_URL=https://api.openai.com/v1
AI_UPSTREAM_API_KEY=your_ai_provider_api_key_here
AI_UPSTREAM_MODEL=your_ai_model_here
AI_PUBLIC_MODEL_NAME=bugfarm-ai
AI_SESSION_REQUEST_LIMIT=100
```

## Scripts

```bash
npm run dev
npm run build
npm start
npm test
```

`npm run dev` starts the TypeScript service with `tsx`.

`npm run build` compiles the service to `dist/`.

`npm start` runs the compiled service from `dist/index.js`.

`npm test` builds the project and runs the local deterministic hidden-test validator suite.

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
  "bugCount": 1,
  "bugDiversification": true
}
```

Only `repoPath` is required. It can be an absolute local path, a GitHub URL, an SSH GitHub URL, `github.com/owner/repo`, or `owner/repo`.

`bugCount` is optional, defaults to `1`, and must be an integer from `1` to `10`.

`bugDiversification` is optional, defaults to `true`, and tells the bug-seeding prompt to prefer materially different bug categories or failure modes when multiple bugs are requested.

GitHub repositories are cloned into a temporary local directory under `/tmp`; BugFarm does not push changes back to GitHub.

This endpoint is asynchronous. It returns `202 Accepted` with a job id and poll URL.

Example:

```bash
curl -X POST http://localhost:3000/seed-bug \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/absolute/path/to/sample-repo",
    "area": "auth",
    "difficulty": "medium",
    "language": "typescript",
    "bugCount": 1,
    "bugDiversification": true
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
    "bugCount": 2,
    "bugDiversification": true
  }'
```

Accepted response:

```json
{
  "status": "accepted",
  "jobId": "4d4bb74abdbfb9f8",
  "operation": "seed-bug",
  "pollUrl": "/jobs/4d4bb74abdbfb9f8"
}
```

Poll until completion:

```bash
curl http://localhost:3000/jobs/4d4bb74abdbfb9f8
```

Succeeded job response:

```json
{
  "jobId": "4d4bb74abdbfb9f8",
  "operation": "seed-bug",
  "status": "succeeded",
  "createdAt": "2026-05-04T10:15:20.000Z",
  "startedAt": "2026-05-04T10:15:20.010Z",
  "completedAt": "2026-05-04T10:15:31.000Z",
  "pollUrl": "/jobs/4d4bb74abdbfb9f8",
  "result": {
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
  "bugDiversification": true,
  "role": "backend engineer",
  "assessmentName": "Backend Debugging Screen"
}
```

This endpoint is asynchronous. It creates a local assessment artifact under `ASSESSMENT_OUTPUT_DIR`, but only returns jobs whose hidden-test validation eventually succeeds.

On success, BugFarm also creates a pending candidate launch session and returns
`candidateLaunchUrl`. Opening that secret URL provisions a Coder user and
workspace for the candidate.

`CODER_URL` is the browser-facing Coder URL shown to candidates. `CODER_API_URL`
is the backend-to-Coder URL used from inside Docker; when Coder runs on the same
VM as the backend container, set it to `http://host.docker.internal:7080`.

### Candidate AI Proxy

Candidate workspaces can use Cline inside code-server, or the `bugfarm-ai`
terminal fallback command, through BugFarm's OpenAI-compatible proxy:

```http
GET /v1/models
POST /v1/chat/completions
Authorization: Bearer <ai_proxy_token>
```

The backend generates one `ai_proxy_token` per candidate session, stores only
its hash, and passes the raw token into the Coder workspace. Cline and
`bugfarm-ai` use that token as their API key and point at
`PUBLIC_BACKEND_URL/v1`.

Real provider credentials must stay only in the backend environment:

```env
AI_UPSTREAM_BASE_URL=https://api.openai.com/v1
AI_UPSTREAM_API_KEY=...
AI_UPSTREAM_MODEL=...
AI_PUBLIC_MODEL_NAME=bugfarm-ai
AI_SESSION_REQUEST_LIMIT=100
```

The proxy overrides candidate-supplied model names with `AI_UPSTREAM_MODEL`,
enforces session expiry/status and request quota, and stores full request and
response transcripts in SQLite for audit/debugging.

### Generate Bug

```http
POST /generate-bug
```

This endpoint is asynchronous. It creates an assessment-style bug artifact with:
- `baseline-repo/`
- `candidate-repo/`
- `reports/BUG_REPORT.md`
- `candidate/TASK.md`
- `patches/bug.patch`
- `rubric.json`
- `assessment.json`

It does not generate hidden tests yet.

Request body is the same shape as `/generate-assessment`.

### Generate Tests

```http
POST /generate-tests
```

This endpoint is asynchronous. It takes an existing artifact produced by `/generate-bug`, generates deterministic hidden tests, validates them, and updates `assessment.json`.

Request:

```json
{
  "artifactPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504103000-a1b2c3d4",
  "language": "python"
}
```

Accepted response:

```json
{
  "status": "accepted",
  "jobId": "7b8b1ea7c2e0aa34",
  "operation": "generate-assessment",
  "pollUrl": "/jobs/7b8b1ea7c2e0aa34"
}
```

Poll until completion:

```bash
curl http://localhost:3000/generate-assessment/jobs/7b8b1ea7c2e0aa34
```

Succeeded job response:

```json
{
  "jobId": "7b8b1ea7c2e0aa34",
  "operation": "generate-assessment",
  "status": "succeeded",
  "createdAt": "2026-05-04T10:20:20.000Z",
  "startedAt": "2026-05-04T10:20:20.010Z",
  "completedAt": "2026-05-04T10:21:05.000Z",
  "pollUrl": "/jobs/7b8b1ea7c2e0aa34",
  "result": {
    "status": "success",
    "assessmentId": "backend-debugging-screen-20260504094530-a1b2c3d4",
    "assessmentName": "Backend Debugging Screen",
    "artifactPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4",
    "candidateRepoPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/candidate-repo",
    "baselineRepoPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/baseline-repo",
    "hiddenTestsPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/hidden-tests",
    "validation": {
      "status": "passed",
      "ecosystem": "node",
      "retryCount": 1,
      "wrapperEntrypoints": ["hidden-tests/generated-wrapper.mjs"],
      "targetSymbols": ["normalizeEmail"]
    },
    "filesChanged": ["src/auth/session.ts", "BUG_REPORT.md"],
    "summary": "Seeded a realistic intentional bug",
    "difficulty": "medium",
    "bugCount": 1,
    "bugReportPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/reports/BUG_REPORT.md",
    "taskPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/candidate/TASK.md",
    "patchPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/patches/bug.patch",
    "rubricPath": "/absolute/path/to/artifacts/backend-debugging-screen-20260504094530-a1b2c3d4/rubric.json"
  },
}
```

Failed jobs return:

```json
{
  "jobId": "7b8b1ea7c2e0aa34",
  "operation": "generate-assessment",
  "status": "failed",
  "createdAt": "2026-05-04T10:20:20.000Z",
  "startedAt": "2026-05-04T10:20:20.010Z",
  "completedAt": "2026-05-04T10:20:28.000Z",
  "pollUrl": "/jobs/7b8b1ea7c2e0aa34",
  "error": {
    "message": "Assessment validation failed: Hidden test generation did not produce a valid spec."
  }
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

### Candidate Launch Flow

```http
GET /candidate/launch/:launchToken
```

The launch URL is returned by `/generate-assessment`. It is an unguessable,
expiring secret link. On first open, the backend:

1. Creates a Coder password user.
2. Creates a Coder workspace from `CODER_TEMPLATE_ID`.
3. Passes the template parameters `artifact_hash`, `session_id`, and
   `artifact_token`.
4. Shows a loader while the workspace and code-server app become healthy.
5. Redirects directly to the public code-server app URL.

The candidate never sees Coder credentials and should not need to log into
Coder. The code-server app is exposed as a public Coder app, so anyone with the
final app URL can access it while the workspace is running.

### Candidate Artifact Download

```http
GET /api/artifacts/:artifact_hash.zip?session_id=:session_id
Authorization: Bearer artifact_token
```

This endpoint is called by the Coder template startup script. It validates the
session-scoped artifact token and returns a zip containing only the candidate
repo. The zip includes candidate instructions in the root `README.md` and
excludes hidden tests, reports, rubric, baseline repo, and assessment metadata.

For this milestone, hidden tests are deterministic and non-candidate-facing. BugFarm asks Cursor to generate a wrapper plus `hidden-tests/spec.json`, captures expected outputs from `baseline-repo`, and then requires `candidate-repo` to diverge on bug-exposing cases while matching baseline on control cases.

If hidden-test generation does not validate after a small number of retries, the artifact is preserved for inspection and `assessment.json` records the failed validation state.

The end-to-end `/generate-assessment` path still requires live access to the Cursor API at runtime because both bug seeding and hidden-test synthesis are agent-driven.

Error response:

```json
{
  "status": "error",
  "message": "Repo path does not exist"
}
```

## How It Works

For `/seed-bug`:

1. Validates the request and creates an in-memory background job.
2. Resolves the requested repository path, cloning GitHub inputs into `/tmp`.
3. Loads the prompt from `prompts/seed-bug.md`.
4. Scans the target repo for a compact file tree and selected source snippets.
5. Sends the assembled prompt to Cursor SDK with the target repo as the working directory.
6. Reads changed files from Git.
7. Confirms `BUG_REPORT.md` exists.
8. Exposes the final result through the job polling route.

For `/generate-bug`:

1. Validates the request and creates an in-memory background job.
2. Resolves the requested repository path.
3. Copies the original repo into `baseline-repo/`.
4. Copies the baseline into `candidate-repo/`.
5. Runs the bug seeder against `candidate-repo/`.
6. Writes `BUG_REPORT.md`, `TASK.md`, `rubric.json`, `bug.patch`, and partial assessment metadata.
7. Exposes the artifact result through the job polling route.

For `/generate-tests`:

1. Validates the artifact path and creates an in-memory background job.
2. Loads the existing assessment artifact.
3. Generates deterministic hidden tests and wrapper files in `hidden-tests/`.
4. Captures baseline outputs as the oracle and validates that candidate behavior differs on bug-exposing cases.
5. Updates `assessment.json` to the completed stage, or marks it as `test-generation-failed` if validation fails.

For `/generate-assessment`:

1. Validates the request and creates an in-memory background job.
2. Runs `/generate-bug` internally.
3. Runs `/generate-tests` internally against the generated artifact.
4. Creates a pending candidate launch session with a secret launch URL.
5. Exposes the final result or failure through the job polling route.

## Notes

- BugFarm intentionally edits the target repository. Use a disposable branch or sample repo when testing.
- Async job state is stored in memory. Jobs do not survive a process restart.
- The prompt instructs Cursor to introduce the requested number of realistic bugs and to avoid malicious, destructive, or hidden behavior.
- Supported source extensions for scan context are `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, and `.sol`.
