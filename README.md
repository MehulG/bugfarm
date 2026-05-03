# BugFarm POC

BugFarm is an HTTP-triggered Node.js/TypeScript service that uses the Cursor SDK to seed one realistic, non-malicious bug into a local Git repository. It is intended for evaluating AI coding agents on real codebases.

## Requirements

- Node.js 22+
- npm
- A Cursor API key
- A local Git repository to mutate

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
  "language": "typescript"
}
```

Only `repoPath` is required.

Example:

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

Success response:

```json
{
  "status": "success",
  "repoPath": "/absolute/path/to/repo",
  "summary": "Seeded a realistic intentional bug",
  "difficulty": "medium",
  "filesChanged": ["src/auth/session.ts", "BUG_REPORT.md"],
  "bugReportPath": "/absolute/path/to/repo/BUG_REPORT.md"
}
```

Error response:

```json
{
  "status": "error",
  "message": "Repo path does not exist"
}
```

## How It Works

1. Validates the requested repository path.
2. Loads the prompt from `prompts/seed-bug.md`.
3. Scans the target repo for a compact file tree and selected source snippets.
4. Sends the assembled prompt to Cursor SDK with the target repo as the working directory.
5. Reads changed files from Git.
6. Confirms `BUG_REPORT.md` exists.
7. Returns a structured JSON response.

## Notes

- BugFarm intentionally edits the target repository. Use a disposable branch or sample repo when testing.
- The prompt instructs Cursor to introduce exactly one realistic bug and to avoid malicious, destructive, or hidden behavior.
- Supported source extensions for scan context are `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, and `.sol`.
