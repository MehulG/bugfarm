# Coder Artifact Template

This Coder template creates a Docker workspace from an assessment artifact zip.
On first startup, the workspace downloads the artifact, extracts it into
`/home/coder/project`, creates `/home/coder/project/.artifact_ready`, and starts
code-server opened at `/home/coder/project`.

On later restarts, the startup script sees `.artifact_ready` and skips the
download/extract step so the candidate's work is preserved.

## Template Inputs

The backend should create the Coder workspace with these immutable parameters:

- `artifact_hash`: artifact identifier used in the artifact download URL.
- `session_id`: assessment session ID passed as a query parameter.
- `artifact_token`: bearer token used to download the artifact.

The template admin must also configure:

- `platform_url`: base URL of the backend that serves artifacts.

## Artifact Endpoint

The backend should expose:

```text
GET /api/artifacts/:artifact_hash.zip?session_id=:session_id
Authorization: Bearer artifact_token
```

The endpoint should return the artifact zip for the requested hash and session.
For example:

```text
artifact_hash = abc123
-> /artifacts/abc123/starter.zip
```

or:

```text
artifact_hash = abc123
-> /artifact-folder/abc123.zip
```

## Token Security

`artifact_token` is passed into the workspace as an environment variable. That
means the candidate can read it from inside the workspace, even if it is marked
sensitive in Terraform or hidden in the Coder UI.

Use only artifact download tokens that are:

- Short-lived.
- Single-use or session-scoped.
- Restricted to the requested artifact and assessment session.
- Never admin tokens, backend service tokens, or broad API tokens.

## Startup Flow

```text
Backend creates bugged repo artifact
        ↓
Backend stores artifact in artifact folder
        ↓
Backend creates Coder workspace with artifact_hash
        ↓
Coder template downloads artifact zip on first startup
        ↓
Workspace extracts files into /home/coder/project
        ↓
Candidate opens code-server
        ↓
Bugged repo is already visible
```

## Validation

Run these checks before publishing:

```sh
terraform fmt -check
coder templates push
```

Then create a test workspace with a known artifact hash, session ID, and scoped
token. Verify:

- `/home/coder/project/.artifact_ready` exists after first startup.
- The artifact files are visible in code-server.
- Candidate-created files remain after workspace restart.
- Invalid tokens and missing artifacts produce clear startup log failures.
