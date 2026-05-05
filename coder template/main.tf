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

    if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
      echo "Installing curl and unzip..."
      sudo apt-get update
      sudo apt-get install -y curl unzip
    fi

    if ! command -v code-server >/dev/null 2>&1; then
      echo "Installing code-server..."
      curl -fsSL https://code-server.dev/install.sh | sh
    fi

    if ! code-server --list-extensions | grep -qi '^continue.continue$'; then
      echo "Installing Continue extension..."
      code-server --install-extension Continue.continue
    fi

    mkdir -p /home/coder/.config/code-server
    cat > /home/coder/.config/code-server/config.yaml <<EOF
bind-addr: 127.0.0.1:13337
auth: none
cert: false
EOF

    PLATFORM_URL_NORMALIZED=$(printf '%s' "$PLATFORM_URL" | sed 's:/*$::')
    AI_PROXY_URL_NORMALIZED="$PLATFORM_URL_NORMALIZED/v1"

    mkdir -p /home/coder/.continue
    cat > /home/coder/.continue/config.yaml <<EOF
name: BugFarm Candidate AI
version: 0.0.1
schema: v1
models:
  - name: bugfarm-ai
    provider: openai
    model: bugfarm-ai
    apiBase: $AI_PROXY_URL_NORMALIZED
    apiKey: $AI_PROXY_TOKEN
    roles:
      - chat
      - edit
      - apply
EOF

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
    "AI_PROXY_URL=${trimsuffix(var.platform_url, "/")}/v1",
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
