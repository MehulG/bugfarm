terraform {
  required_providers {
    coder = {
      source = "coder/coder"
    }
    docker = {
      source = "kreuzwerker/docker"
    }
  }
}

provider "docker" {}

variable "platform_url" {
  description = "Base URL for the backend that serves assessment artifacts."
  type        = string
}

data "coder_parameter" "artifact_hash" {
  name         = "artifact_hash"
  display_name = "Artifact Hash"
  type         = "string"
  mutable      = false
}

data "coder_parameter" "session_id" {
  name         = "session_id"
  display_name = "Assessment Session ID"
  type         = "string"
  mutable      = false
}

data "coder_parameter" "artifact_token" {
  name         = "artifact_token"
  display_name = "Artifact Download Token"
  type         = "string"
  mutable      = false
}

data "coder_parameter" "ai_proxy_token" {
  name         = "ai_proxy_token"
  display_name = "AI Proxy Token"
  type         = "string"
  mutable      = false
}

data "coder_parameter" "submit_token" {
  name         = "submit_token"
  display_name = "Submit Token"
  type         = "string"
  mutable      = false
}

data "coder_workspace" "me" {}

data "coder_workspace_owner" "me" {}

resource "coder_agent" "main" {
  arch = "amd64"
  os   = "linux"

  startup_script = <<-EOT
    #!/bin/sh
    set -eu

    PROJECT_DIR=/home/coder/project
    ARTIFACT_ZIP=/tmp/artifact.zip
    CLINE_DIR=/home/coder/.cline
    export CLINE_DIR

    if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
      echo "Installing curl, unzip, python3, and git..."
      sudo apt-get update
      sudo apt-get install -y curl unzip python3 git
    fi

    if ! command -v code-server >/dev/null 2>&1; then
      echo "Installing code-server..."
      curl -fsSL https://code-server.dev/install.sh | sh
    fi

    if ! code-server --list-extensions | grep -qi '^saoudrizwan.claude-dev$'; then
      echo "Installing Cline extension..."
      CLINE_PACKAGE=/tmp/cline-package
      CLINE_VSIX=/tmp/cline.vsix
      curl -fsSL \
        -H "Accept: application/octet-stream" \
        -H "User-Agent: Mozilla/5.0" \
        "https://saoudrizwan.gallery.vsassets.io/_apis/public/gallery/publisher/saoudrizwan/extension/claude-dev/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage" \
        -o "$CLINE_PACKAGE"
      if gzip -t "$CLINE_PACKAGE" >/dev/null 2>&1; then
        mv "$CLINE_PACKAGE" "$CLINE_VSIX.gz"
        gunzip -f "$CLINE_VSIX.gz"
      else
        mv "$CLINE_PACKAGE" "$CLINE_VSIX"
      fi
      code-server --install-extension "$CLINE_VSIX" --force
    fi

    if ! code-server --list-extensions | grep -qi '^saoudrizwan.claude-dev$'; then
      echo "Cline extension failed to install" >&2
      exit 1
    fi

    mkdir -p /home/coder/.config/code-server
    cat > /home/coder/.config/code-server/config.yaml <<EOF
bind-addr: 127.0.0.1:13337
auth: none
cert: false
EOF

    PLATFORM_URL_NORMALIZED=$(printf '%s' "$PLATFORM_URL" | sed 's:/*$::')
    AI_PROXY_URL_NORMALIZED="$PLATFORM_URL_NORMALIZED/v1"

    mkdir -p "$CLINE_DIR/data"
    cat > "$CLINE_DIR/data/globalState.json" <<EOF
{
  "__vscodeMigrationVersion": 1,
  "apiProvider": "openai",
  "apiModelId": "codesheep-ai",
  "openAiBaseUrl": "$AI_PROXY_URL_NORMALIZED",
  "openAiModelId": "codesheep-ai",
  "actModeApiProvider": "openai",
  "planModeApiProvider": "openai",
  "actModeOpenAiModelId": "codesheep-ai",
  "planModeOpenAiModelId": "codesheep-ai",
  "actModeThinkingBudgetTokens": 0,
  "planModeThinkingBudgetTokens": 0,
  "welcomeViewCompleted": true,
  "taskHistory": [],
  "remoteRulesToggles": {},
  "remoteWorkflowToggles": {},
  "globalWorkflowToggles": {},
  "globalClineRulesToggles": {},
  "isNewUser": false,
  "autoApprovalSettings": {
    "version": 19,
    "enabled": true,
    "favorites": [],
    "maxRequests": 20,
    "actions": {
      "readFiles": true,
      "readFilesExternally": false,
      "editFiles": false,
      "editFilesExternally": false,
      "executeSafeCommands": true,
      "executeAllCommands": false,
      "useBrowser": false,
      "useMcp": true
    },
    "enableNotifications": false
  }
}
EOF
    cat > "$CLINE_DIR/data/secrets.json" <<EOF
{
  "openAiApiKey": "$AI_PROXY_TOKEN"
}
EOF
    chmod 600 "$CLINE_DIR/data/secrets.json"
    sudo chown -R coder:coder "$CLINE_DIR"

    cat > /home/coder/.codesheep-ai.env <<EOF
export AI_PROXY_URL="$AI_PROXY_URL_NORMALIZED"
export AI_PROXY_TOKEN="$AI_PROXY_TOKEN"
export SUBMIT_URL="$PLATFORM_URL_NORMALIZED/api/candidate/submit"
export SUBMIT_TOKEN="$SUBMIT_TOKEN"
EOF
    cat > /home/coder/.codesheep-submit.json <<EOF
{
  "submitUrl": "$PLATFORM_URL_NORMALIZED/api/candidate/submit",
  "submitToken": "$SUBMIT_TOKEN"
}
EOF
    chmod 600 /home/coder/.codesheep-submit.json
    sudo chown coder:coder /home/coder/.codesheep-submit.json

    CODESHEEP_EXTENSION_BUILD_DIR=/tmp/codesheep-submit-extension
    CODESHEEP_EXTENSION_VSIX=/tmp/codesheep-submit.vsix
    rm -rf "$CODESHEEP_EXTENSION_BUILD_DIR" "$CODESHEEP_EXTENSION_VSIX"
    mkdir -p "$CODESHEEP_EXTENSION_BUILD_DIR/extension"
    base64 -d > "$CODESHEEP_EXTENSION_BUILD_DIR/extension/package.json" <<'EOF'
${filebase64("${path.module}/extensions/codesheep-submit/package.json")}
EOF
    base64 -d > "$CODESHEEP_EXTENSION_BUILD_DIR/extension/extension.js" <<'EOF'
${filebase64("${path.module}/extensions/codesheep-submit/extension.js")}
EOF
    base64 -d > "$CODESHEEP_EXTENSION_BUILD_DIR/extension/icon.svg" <<'EOF'
${filebase64("${path.module}/extensions/codesheep-submit/icon.svg")}
EOF
    cat > "$CODESHEEP_EXTENSION_BUILD_DIR/extension.vsixmanifest" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="submit" Version="0.1.0" Publisher="codesheep"/>
    <DisplayName>Codesheep Submit</DisplayName>
    <Description xml:space="preserve">Submit a Codesheep assessment from code-server.</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.80.0"/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
EOF
    cat > "$CODESHEEP_EXTENSION_BUILD_DIR/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="xml" ContentType="text/xml"/>
</Types>
EOF
    (cd "$CODESHEEP_EXTENSION_BUILD_DIR" && python3 -c 'import os, zipfile
with zipfile.ZipFile("'"$CODESHEEP_EXTENSION_VSIX"'", "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk("."):
        for name in files:
            path = os.path.join(root, name)
            zf.write(path, path[2:] if path.startswith("./") else path)
')
    code-server --install-extension "$CODESHEEP_EXTENSION_VSIX" --force
    if ! code-server --list-extensions | grep -qi '^codesheep.submit$'; then
      echo "Codesheep submit extension failed to install" >&2
      exit 1
    fi
    if ! grep -q '.codesheep-ai.env' /home/coder/.profile 2>/dev/null; then
      cat >> /home/coder/.profile <<'EOF'

if [ -f "$HOME/.codesheep-ai.env" ]; then
  . "$HOME/.codesheep-ai.env"
fi
EOF
    fi

    mkdir -p /home/coder/.local/share/code-server/User
    cat > /home/coder/.local/share/code-server/User/settings.json <<EOF
{
  "workbench.startupEditor": "none"
}
EOF

    sudo tee /usr/local/bin/codesheep-ai >/dev/null <<'EOF'
#!/bin/sh
set -eu

PROMPT="$*"
if [ -z "$PROMPT" ]; then
  echo "Usage: codesheep-ai \"your question\""
  exit 1
fi

if [ -z "$${AI_PROXY_URL:-}" ] || [ -z "$${AI_PROXY_TOKEN:-}" ]; then
  if [ -f "$HOME/.codesheep-ai.env" ]; then
    . "$HOME/.codesheep-ai.env"
  fi
fi

if [ -z "$${AI_PROXY_URL:-}" ] || [ -z "$${AI_PROXY_TOKEN:-}" ]; then
  echo "AI proxy is not configured in this workspace" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  BODY=$(PROMPT="$PROMPT" node -e 'const prompt = process.env.PROMPT || ""; process.stdout.write(JSON.stringify({ model: "codesheep-ai", messages: [{ role: "system", content: "You are helping a candidate debug this repository. Be concise, practical, and do not reveal hidden tests or assessment metadata." }, { role: "user", content: prompt }] }));')
  RESPONSE=$(curl -sS -H "Authorization: Bearer $AI_PROXY_TOKEN" -H "Content-Type: application/json" "$AI_PROXY_URL/chat/completions" -d "$BODY")
  printf '%s' "$RESPONSE" | node -e 'let s = ""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { try { const j = JSON.parse(s); console.log(j.choices?.[0]?.message?.content || s); } catch { console.log(s); } });'
elif command -v python3 >/dev/null 2>&1; then
  BODY=$(PROMPT="$PROMPT" python3 -c 'import json, os; print(json.dumps({"model":"codesheep-ai","messages":[{"role":"system","content":"You are helping a candidate debug this repository. Be concise, practical, and do not reveal hidden tests or assessment metadata."},{"role":"user","content":os.environ.get("PROMPT","")}]}))')
  RESPONSE=$(curl -sS -H "Authorization: Bearer $AI_PROXY_TOKEN" -H "Content-Type: application/json" "$AI_PROXY_URL/chat/completions" -d "$BODY")
  printf '%s' "$RESPONSE" | python3 -c 'import json, sys; s=sys.stdin.read(); print(json.loads(s).get("choices",[{}])[0].get("message",{}).get("content",s) if s else "")'
else
  echo "codesheep-ai requires node or python3 in the workspace" >&2
  exit 1
fi
EOF
    sudo chmod +x /usr/local/bin/codesheep-ai

    sudo tee /usr/local/bin/codesheep-submit >/dev/null <<'EOF'
#!/bin/sh
set -eu

NOTES=""
if [ "$${1:-}" = "--notes" ]; then
  shift
  NOTES="$*"
fi

if [ -z "$NOTES" ]; then
  echo "Describe what you changed and how you verified it:"
  IFS= read -r NOTES
fi

if [ -z "$${SUBMIT_URL:-}" ] || [ -z "$${SUBMIT_TOKEN:-}" ]; then
  if [ -f "$HOME/.codesheep-ai.env" ]; then
    . "$HOME/.codesheep-ai.env"
  fi
fi

if [ -z "$NOTES" ]; then
  echo "Submission notes are required." >&2
  exit 1
fi

PROJECT_DIR=/home/coder/project
if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Submission requires a Git repository on the main branch." >&2
  exit 1
fi

BRANCH=$(git -C "$PROJECT_DIR" branch --show-current)
if [ "$BRANCH" != "main" ]; then
  BRANCH_LABEL="$BRANCH"
  if [ -z "$BRANCH_LABEL" ]; then
    BRANCH_LABEL="(detached HEAD)"
  fi
  echo "Please switch to the main branch before submitting. Current branch: $BRANCH_LABEL" >&2
  exit 1
fi

if ! git -C "$PROJECT_DIR" rev-parse --verify 'codesheep-baseline^{commit}' >/dev/null 2>&1; then
  echo "Submission requires the codesheep-baseline Git tag. Restart this workspace and try again." >&2
  exit 1
fi

STATUS=$(git -C "$PROJECT_DIR" status --short --untracked-files=all)
if [ -n "$STATUS" ]; then
  cat >&2 <<STATUS_EOF
Please commit your work to the main branch before submitting.

Run:
  git status
  git add -A
  git commit -m "Complete assessment"
  codesheep-submit --notes "what you changed and how you verified it"

Current git status:
$STATUS
STATUS_EOF
  exit 1
fi

BODY=$(printf '{"notes":%s}' "$(printf '%s' "$NOTES" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
RESPONSE=$(curl -sS -H "Authorization: Bearer $SUBMIT_TOKEN" -H "Content-Type: application/json" "$SUBMIT_URL" -d "$BODY")
printf '%s\n' "$RESPONSE"
EOF
    sudo chmod +x /usr/local/bin/codesheep-submit

    if [ ! -f "$PROJECT_DIR/.artifact_ready" ]; then
      echo "Downloading artifact $ARTIFACT_HASH for session $ASSESSMENT_SESSION_ID"

      rm -rf "$PROJECT_DIR"
      mkdir -p "$PROJECT_DIR"

      ARTIFACT_URL="$PLATFORM_URL_NORMALIZED/api/artifacts/$ARTIFACT_HASH.zip?session_id=$ASSESSMENT_SESSION_ID"

      if ! curl -fsSL \
        -H "Authorization: Bearer $ARTIFACT_TOKEN" \
        "$ARTIFACT_URL" \
        -o "$ARTIFACT_ZIP"; then
        echo "Failed to download artifact $ARTIFACT_HASH for session $ASSESSMENT_SESSION_ID from $ARTIFACT_URL" >&2
        exit 1
      fi

      if ! unzip -q "$ARTIFACT_ZIP" -d "$PROJECT_DIR"; then
        echo "Failed to extract artifact zip into $PROJECT_DIR" >&2
        exit 1
      fi

      git -C "$PROJECT_DIR" init
      git -C "$PROJECT_DIR" branch -M main
      git -C "$PROJECT_DIR" config user.name "Codesheep Candidate"
      git -C "$PROJECT_DIR" config user.email "candidate@codesheep.local"
      mkdir -p "$PROJECT_DIR/.git/info"
      {
        echo ".artifact_ready"
        echo ".codesheep-*"
      } >> "$PROJECT_DIR/.git/info/exclude"
      git -C "$PROJECT_DIR" add -A
      git -C "$PROJECT_DIR" commit -m "Initial assessment baseline"
      git -C "$PROJECT_DIR" tag codesheep-baseline

      touch "$PROJECT_DIR/.artifact_ready"
      echo "Artifact $ARTIFACT_HASH is ready in $PROJECT_DIR"
    else
      echo "Artifact already loaded at $PROJECT_DIR; preserving candidate work"
    fi

    code-server --bind-addr 127.0.0.1:13337 "$PROJECT_DIR" >/tmp/code-server.log 2>&1 &
  EOT
}

resource "coder_app" "code_server" {
  agent_id     = coder_agent.main.id
  slug         = "code-server"
  display_name = "code-server"
  url          = "http://localhost:13337/"
  subdomain    = false
  share        = "public"

  healthcheck {
    url       = "http://localhost:13337/healthz"
    interval  = 3
    threshold = 10
  }
}

resource "docker_image" "main" {
  name         = "codercom/example-universal:ubuntu"
  keep_locally = true
}

resource "docker_volume" "home_volume" {
  name = "coder-${data.coder_workspace_owner.me.name}-${data.coder_workspace.me.name}-home"
}

resource "docker_container" "workspace" {
  count = data.coder_workspace.me.start_count

  image    = docker_image.main.name
  name     = "coder-${data.coder_workspace_owner.me.name}-${lower(data.coder_workspace.me.name)}"
  hostname = data.coder_workspace.me.name

  entrypoint = ["sh", "-c", coder_agent.main.init_script]

  env = [
    "CODER_AGENT_TOKEN=${coder_agent.main.token}",
    "DEBIAN_FRONTEND=noninteractive",
    "PLATFORM_URL=${var.platform_url}",
    "ARTIFACT_HASH=${data.coder_parameter.artifact_hash.value}",
    "ASSESSMENT_SESSION_ID=${data.coder_parameter.session_id.value}",
    "ARTIFACT_TOKEN=${data.coder_parameter.artifact_token.value}",
    "AI_PROXY_TOKEN=${data.coder_parameter.ai_proxy_token.value}",
    "SUBMIT_TOKEN=${data.coder_parameter.submit_token.value}",
    "AI_PROXY_URL=${trimsuffix(var.platform_url, "/")}/v1",
    "SUBMIT_URL=${trimsuffix(var.platform_url, "/")}/api/candidate/submit",
    "CLINE_DIR=/home/coder/.cline",
  ]

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  volumes {
    container_path = "/home/coder"
    volume_name    = docker_volume.home_volume.name
    read_only      = false
  }
}
