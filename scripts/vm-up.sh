#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env.vm"
COMPOSE_FILE="$ROOT_DIR/compose.vm.yaml"
TEMPLATE_DIR="$ROOT_DIR/coder template"

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.vm.example" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.vm.example."
  echo "Edit $ENV_FILE with your tunnel URLs and provider keys, then run this script again."
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

is_placeholder_value() {
  value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  case "$value" in
    *your_*|*example.com*|*"_here")
      return 0
      ;;
  esac
  return 1
}

require_env() {
  name="$1"
  value=$(eval "printf '%s' \"\${$name:-}\"")
  if is_placeholder_value "$value"; then
    echo "Missing required env: $name in $ENV_FILE" >&2
    exit 1
  fi
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

read_env_file_value() {
  name="$1"
  file="$2"
  if [ ! -f "$file" ]; then
    return 1
  fi
  awk -v key="$name" '
    index($0, key "=") == 1 {
      sub("^[^=]*=", "")
      print
      found = 1
      exit
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$file"
}

import_from_dotenv_if_missing() {
  name="$1"
  current_value=$(eval "printf '%s' \"\${$name:-}\"")
  if ! is_placeholder_value "$current_value"; then
    return 0
  fi
  imported_value=$(read_env_file_value "$name" "$ROOT_DIR/.env" 2>/dev/null || true)
  if is_placeholder_value "$imported_value"; then
    return 0
  fi
  upsert_env "$name" "$imported_value"
  echo "Imported $name from .env into .env.vm."
}

import_from_dotenv_if_missing CURSOR_API_KEY
import_from_dotenv_if_missing AI_UPSTREAM_BASE_URL
import_from_dotenv_if_missing AI_UPSTREAM_API_KEY
import_from_dotenv_if_missing AI_UPSTREAM_MODEL

set -a
. "$ENV_FILE"
set +a

require_env CODER_ACCESS_URL
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
CODER_CLI_URL="${CODER_CLI_URL:-http://127.0.0.1:7080}"
CODER_ADMIN_EMAIL="${CODER_ADMIN_EMAIL:-admin@bugfarm.ai}"
CODER_ADMIN_USERNAME="${CODER_ADMIN_USERNAME:-admin}"
CODER_ADMIN_FULL_NAME="${CODER_ADMIN_FULL_NAME:-BugFarm Admin}"
CODER_ADMIN_PASSWORD="${CODER_ADMIN_PASSWORD:-Admin@1234567890}"
CODER_API_TOKEN_LIFETIME="${CODER_API_TOKEN_LIFETIME:-168h}"
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

export CODER_URL="$CODER_CLI_URL"
export CODER_SESSION_TOKEN="${CODER_API_TOKEN:-}"

if is_placeholder_value "${CODER_API_TOKEN:-}" || ! coder whoami >/dev/null 2>&1; then
  echo "Bootstrapping Coder admin and API token..."
  unset CODER_SESSION_TOKEN
  export CODER_FIRST_USER_EMAIL="$CODER_ADMIN_EMAIL"
  export CODER_FIRST_USER_USERNAME="$CODER_ADMIN_USERNAME"
  export CODER_FIRST_USER_FULL_NAME="$CODER_ADMIN_FULL_NAME"
  export CODER_FIRST_USER_PASSWORD="$CODER_ADMIN_PASSWORD"
  export CODER_FIRST_USER_TRIAL=false

  if ! coder login "$CODER_CLI_URL" \
    --first-user-email "$CODER_ADMIN_EMAIL" \
    --first-user-username "$CODER_ADMIN_USERNAME" \
    --first-user-full-name "$CODER_ADMIN_FULL_NAME" \
    --first-user-password "$CODER_ADMIN_PASSWORD" \
    --first-user-trial=false >/dev/null; then
    echo "Could not bootstrap/login to Coder at $CODER_CLI_URL." >&2
    echo "Check Coder logs with:" >&2
    echo "docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs coder" >&2
    exit 1
  fi

  token_name="bugfarm-vm-admin-$(date +%Y%m%d%H%M%S)"
  CODER_API_TOKEN=$(coder tokens create --name "$token_name" --lifetime "$CODER_API_TOKEN_LIFETIME" | tail -n 1)
  if is_placeholder_value "$CODER_API_TOKEN"; then
    echo "Coder login worked, but token creation did not return a token." >&2
    exit 1
  fi
  upsert_env CODER_API_TOKEN "$CODER_API_TOKEN"
  export CODER_SESSION_TOKEN="$CODER_API_TOKEN"
  echo "Created Coder admin API token and wrote it to .env.vm."
fi

if ! coder whoami >/dev/null 2>&1; then
  echo "CODER_API_TOKEN could not authenticate to $CODER_CLI_URL." >&2
  exit 1
fi

echo "Pushing Coder template '$CODER_TEMPLATE_NAME'..."
coder templates push "$CODER_TEMPLATE_NAME" \
  --directory "$TEMPLATE_DIR" \
  --var "platform_url=$PUBLIC_BACKEND_URL" \
  --yes

echo "Discovering Coder organization ID..."
CODER_ORGANIZATION_ID=$(coder organizations show selected --only-id 2>/dev/null || true)
if [ -z "$CODER_ORGANIZATION_ID" ]; then
  CODER_ORGANIZATION_ID=$(
    coder organizations list --output json 2>/dev/null | python3 -c '
import json, sys
data = json.load(sys.stdin)
if isinstance(data, dict):
    rows = data.get("organizations") or data.get("data") or data.get("rows") or []
else:
    rows = data
for row in rows:
    value = row.get("id") or row.get("organization_id")
    if value:
        print(value)
        raise SystemExit(0)
raise SystemExit(1)
' 2>/dev/null || true
  )
fi
if [ -z "$CODER_ORGANIZATION_ID" ]; then
  echo "Could not discover Coder organization ID." >&2
  exit 1
fi

echo "Discovering Coder template ID..."
CODER_TEMPLATE_ID=$(
  coder templates list --output json 2>/dev/null | python3 -c '
import json, os, sys
name = os.environ["CODER_TEMPLATE_NAME"]
data = json.load(sys.stdin)
if isinstance(data, dict):
    rows = data.get("templates") or data.get("data") or data.get("rows") or []
else:
    rows = data
for row in rows:
    candidate = row.get("Template") if isinstance(row, dict) and isinstance(row.get("Template"), dict) else row
    if candidate.get("name") == name:
        value = candidate.get("id") or candidate.get("template_id")
        if value:
            print(value)
            raise SystemExit(0)
raise SystemExit(1)
' 2>/dev/null || true
)

if [ -z "$CODER_TEMPLATE_ID" ]; then
  CODER_TEMPLATE_ID=$(
    curl -fsS "$CODER_CLI_URL/api/v2/templates" \
      -H "Coder-Session-Token: $CODER_API_TOKEN" | python3 -c '
import json, os, sys
name = os.environ["CODER_TEMPLATE_NAME"]
data = json.load(sys.stdin)
rows = data if isinstance(data, list) else data.get("templates") or data.get("data") or data.get("rows") or []
for row in rows:
    if row.get("name") == name:
        value = row.get("id") or row.get("template_id")
        if value:
            print(value)
            raise SystemExit(0)
raise SystemExit(1)
' 2>/dev/null || true
  )
fi

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
