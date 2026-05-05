#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env.vm"
COMPOSE_FILE="$ROOT_DIR/compose.vm.yaml"
TEMPLATE_DIR="$ROOT_DIR/coder template"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.vm.example" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.vm.example."
  echo "Edit $ENV_FILE with your tunnel URLs and tokens, then run this script again."
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

require_env() {
  name="$1"
  value=$(eval "printf '%s' \"\${$name:-}\"")
  if [ -z "$value" ]; then
    echo "Missing required env: $name in $ENV_FILE" >&2
    exit 1
  fi
  case "$value" in
    *your_*|*example.com*|*"_here")
      echo "Replace placeholder value for $name in $ENV_FILE" >&2
      exit 1
      ;;
  esac
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

upsert_env() {
  name="$1"
  value="$2"
  tmp="$ENV_FILE.tmp.$$"
  if grep -q "^$name=" "$ENV_FILE"; then
    awk -v key="$name" -v val="$value" '
      index($0, key "=") == 1 { print key "=" val; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
  else
    cp "$ENV_FILE" "$tmp"
    printf '%s=%s\n' "$name" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

require_env CODER_ACCESS_URL
require_env CODER_API_TOKEN
require_env PUBLIC_BACKEND_URL
require_env CURSOR_API_KEY
require_env AI_UPSTREAM_API_KEY
require_env AI_UPSTREAM_MODEL

require_command docker
require_command coder
require_command curl
require_command python3

CODER_TEMPLATE_NAME="${CODER_TEMPLATE_NAME:-artifact-template}"
CODER_API_URL="${CODER_API_URL:-http://host.docker.internal:7080}"
CODER_WORKSPACE_TTL_MS="${CODER_WORKSPACE_TTL_MS:-14400000}"
AI_PROXY_ENABLED="${AI_PROXY_ENABLED:-true}"
AI_UPSTREAM_BASE_URL="${AI_UPSTREAM_BASE_URL:-https://api.openai.com/v1}"
AI_PUBLIC_MODEL_NAME="${AI_PUBLIC_MODEL_NAME:-bugfarm-ai}"
AI_SESSION_REQUEST_LIMIT="${AI_SESSION_REQUEST_LIMIT:-100}"
MODEL_NAME="${MODEL_NAME:-default}"
REPO_SCAN_MAX_FILES="${REPO_SCAN_MAX_FILES:-40}"
REPO_SCAN_MAX_CHARS="${REPO_SCAN_MAX_CHARS:-150000}"

mkdir -p "$ROOT_DIR/data/artifacts"

echo "Starting Coder..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d coder-database coder

echo "Waiting for local Coder API on http://127.0.0.1:7080..."
attempt=1
while [ "$attempt" -le 60 ]; do
  if curl -fsS http://127.0.0.1:7080/api/v2/buildinfo >/dev/null 2>&1; then
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [ "$attempt" -gt 60 ]; then
  echo "Coder did not become ready. Check logs with:" >&2
  echo "docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs coder" >&2
  exit 1
fi

export CODER_URL="$CODER_ACCESS_URL"
export CODER_SESSION_TOKEN="$CODER_API_TOKEN"

if ! coder whoami >/dev/null 2>&1; then
  echo "CODER_API_TOKEN could not authenticate to $CODER_ACCESS_URL." >&2
  echo "Create/login as the first Coder admin, create an API token, set CODER_API_TOKEN in $ENV_FILE, then rerun." >&2
  exit 1
fi

echo "Pushing Coder template '$CODER_TEMPLATE_NAME'..."
coder templates push "$CODER_TEMPLATE_NAME" \
  --directory "$TEMPLATE_DIR" \
  --var "platform_url=$PUBLIC_BACKEND_URL" \
  --yes

CODER_ORGANIZATION_ID=$(coder organizations show selected --only-id)
if [ -z "$CODER_ORGANIZATION_ID" ]; then
  echo "Could not discover Coder organization ID." >&2
  exit 1
fi

CODER_TEMPLATE_ID=$(
  coder templates list --output json | python3 -c '
import json, os, sys
name = os.environ["CODER_TEMPLATE_NAME"]
data = json.load(sys.stdin)
if isinstance(data, dict):
    rows = data.get("templates") or data.get("data") or data.get("rows") or []
else:
    rows = data
for row in rows:
    if row.get("name") == name:
        value = row.get("id") or row.get("template_id")
        if value:
            print(value)
            raise SystemExit(0)
raise SystemExit(1)
'
)

if [ -z "$CODER_TEMPLATE_ID" ]; then
  echo "Could not discover Coder template ID for $CODER_TEMPLATE_NAME." >&2
  exit 1
fi

upsert_env CODER_ORGANIZATION_ID "$CODER_ORGANIZATION_ID"
upsert_env CODER_TEMPLATE_ID "$CODER_TEMPLATE_ID"

echo "Updated $ENV_FILE with:"
echo "  CODER_ORGANIZATION_ID=$CODER_ORGANIZATION_ID"
echo "  CODER_TEMPLATE_ID=$CODER_TEMPLATE_ID"

echo "Starting backend..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build bugfarm

echo "Done."
echo "Backend: $PUBLIC_BACKEND_URL"
echo "Coder:   $CODER_ACCESS_URL"
echo
echo "Check backend logs:"
echo "docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs -f bugfarm"
