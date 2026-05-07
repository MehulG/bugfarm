# Coder Artifact Template

This Coder template creates a Docker workspace from an assessment artifact zip.
On first startup, the workspace downloads the artifact, extracts it into
`/home/coder/project`, creates `/home/coder/project/.artifact_ready`, and starts
code-server opened at `/home/coder/project`.

The code-server Coder app is shared publicly so candidate launch links can
redirect to code-server without requiring a separate Coder login.
The workspace also installs the Cline extension, configures it to use the
Codesheep backend AI proxy, skips Cline onboarding by writing Cline's state files,
and installs a `codesheep-ai` terminal fallback command. Real provider API keys
are never written into the workspace.

If Cline cannot be installed, workspace startup fails before code-server starts.
That keeps candidate workspaces from opening in a half-configured state.

On later restarts, the startup script sees `.artifact_ready` and skips the
download/extract step so the candidate's work is preserved.

## Template Inputs

The backend should create the Coder workspace with these immutable parameters:

- `artifact_hash`: artifact identifier used in the artifact download URL.
- `session_id`: assessment session ID passed as a query parameter.
- `artifact_token`: bearer token used to download the artifact.
- `ai_proxy_token`: bearer token used by Cline and `codesheep-ai` to call the backend AI proxy.

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

`artifact_token` and `ai_proxy_token` are passed into the workspace as
environment variables. That means the candidate can read them from inside the
workspace, even if they are marked sensitive in Terraform or hidden in the Coder
UI.

Use only scoped tokens that are:

- Short-lived.
- Single-use or session-scoped.
- Restricted to the requested artifact or AI proxy session.
- Never admin tokens, backend service tokens, or broad API tokens.

The `ai_proxy_token` must never be a provider key. It should only authorize the
workspace to call the backend's OpenAI-compatible `/v1` proxy for that candidate
session.

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
Workspace installs Cline, writes Cline state/secrets, and installs codesheep-ai
        ↓
Candidate opens code-server
        ↓
Bugged repo and Cline AI assistance are already available
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
- Cline is installed and `~/.cline/data/globalState.json` points to the backend
  `/v1` proxy.
- `~/.cline/data/secrets.json` contains only the scoped AI proxy token, not a
  real provider API key.
- The workspace environment contains `CLINE_DIR=/home/coder/.cline` so
  code-server's extension host reads the preseeded Cline state.
- `codesheep-ai "Say hello"` works from the terminal.
- `AI_ASSISTANT.md` exists in `/home/coder/project` and explains that Cline is
  preconfigured.
- Candidate-created files remain after workspace restart.
- Invalid tokens and missing artifacts produce clear startup log failures.
