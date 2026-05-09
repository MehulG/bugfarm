const fs = require("fs");
const childProcess = require("child_process");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const CONFIG_PATH = path.join(os.homedir(), ".codesheep-submit.json");
const VIEW_ID = "codesheep.submitView";

function activate(context) {
  const provider = new SubmitViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("codesheep.submitAssessment", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.codesheep-submit");
      provider.focusNotes();
    }),
  );
}

function deactivate() {}

class SubmitViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = undefined;
    this.submitted = false;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
  }

  focusNotes() {
    this.view?.webview.postMessage({ type: "focusNotes" });
  }

  async handleMessage(message) {
    if (!message || message.type !== "submit") {
      return;
    }

    if (this.submitted) {
      this.postStatus("success", "This assessment has already been submitted from this workspace.", true);
      return;
    }

    const notes = typeof message.notes === "string" ? message.notes.trim() : "";
    if (!notes) {
      this.postStatus("error", "Submission notes are required.", false);
      return;
    }

    let config;
    try {
      config = readConfig();
      assertGitReady();
    } catch (error) {
      this.postStatus("error", error.message, false);
      return;
    }

    this.postStatus("pending", "Submitting assessment...", false);
    try {
      const response = await submitAssessment(config, notes);
      const accepted = response.statusCode >= 200 && response.statusCode < 300;
      const messageText = response.body?.message || response.body?.status || response.rawBody || "Submission accepted.";
      if (!accepted || response.body?.status === "error") {
        this.postStatus("error", messageText, false);
        return;
      }

      this.submitted = true;
      this.postStatus("success", messageText, true);
      vscode.window.showInformationMessage("Codesheep assessment submitted.");
    } catch (error) {
      this.postStatus("error", error.message || "Submission failed.", false);
    }
  }

  postStatus(kind, message, submitted) {
    this.view?.webview.postMessage({ type: "status", kind, message, submitted });
  }

  renderHtml(webview) {
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { color-scheme: light dark; }
    body { padding: 14px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    label { display: block; margin-bottom: 8px; font-weight: 600; }
    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 150px;
      resize: vertical;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button {
      width: 100%;
      margin-top: 12px;
      padding: 8px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .65; cursor: not-allowed; }
    .status {
      margin-top: 12px;
      padding: 8px;
      border-radius: 4px;
      display: none;
      white-space: pre-wrap;
    }
    .status.pending { display: block; background: var(--vscode-inputValidation-infoBackground); border: 1px solid var(--vscode-inputValidation-infoBorder); }
    .status.success { display: block; background: var(--vscode-testing-iconPassed, #2ea043); color: var(--vscode-button-foreground); }
    .status.error { display: block; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  </style>
</head>
<body>
  <label for="notes">What did you change and how did you verify it?</label>
  <textarea id="notes" placeholder="Example: Fixed the cart quantity bug and verified with npm test."></textarea>
  <button id="submit" type="button">Submit Assessment</button>
  <div id="status" class="status" role="status"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const notes = document.getElementById("notes");
    const button = document.getElementById("submit");
    const status = document.getElementById("status");

    function setStatus(kind, message) {
      status.className = "status " + kind;
      status.textContent = message || "";
    }

    button.addEventListener("click", () => {
      const value = notes.value.trim();
      if (!value) {
        setStatus("error", "Submission notes are required.");
        notes.focus();
        return;
      }
      button.disabled = true;
      setStatus("pending", "Submitting assessment...");
      vscode.postMessage({ type: "submit", notes: value });
    });

    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "focusNotes") {
        notes.focus();
        return;
      }
      if (message.type !== "status") {
        return;
      }
      setStatus(message.kind, message.message);
      button.disabled = Boolean(message.submitted) || message.kind === "pending";
      if (!button.disabled) {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
  }
}

function assertGitReady() {
  const repoPath = getProjectPath();
  try {
    git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error("Submission requires a Git repository on the main branch.");
  }

  const branch = git(repoPath, ["branch", "--show-current"]).trim();
  if (branch !== "main") {
    throw new Error(`Please switch to the main branch before submitting. Current branch: ${branch || "(detached HEAD)"}`);
  }

  try {
    git(repoPath, ["rev-parse", "--verify", "codesheep-baseline^{commit}"]);
  } catch {
    throw new Error("Submission requires the codesheep-baseline Git tag. Restart this workspace and try again.");
  }

  const status = git(repoPath, ["status", "--short", "--untracked-files=all"]).trim();
  if (status) {
    throw new Error([
      "Please commit your work to the main branch before submitting.",
      "",
      "Run:",
      "  git status",
      "  git add -A",
      '  git commit -m "Complete assessment"',
      '  codesheep-submit --notes "what you changed and how you verified it"',
      "",
      "Current git status:",
      status,
    ].join("\n"));
  }
}

function getProjectPath() {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || "/home/coder/project";
}

function git(repoPath, args) {
  return childProcess.execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error("Codesheep submit config is missing. Restart the workspace and try again.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codesheep submit config is invalid. Restart the workspace and try again.");
  }

  if (!parsed.submitUrl || !parsed.submitToken) {
    throw new Error("Codesheep submit config is incomplete. Restart the workspace and try again.");
  }

  return {
    submitUrl: parsed.submitUrl,
    submitToken: parsed.submitToken,
  };
}

function submitAssessment(config, notes) {
  const url = new URL(config.submitUrl);
  const payload = JSON.stringify({ notes });
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.submitToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let rawBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          let body;
          try {
            body = rawBody ? JSON.parse(rawBody) : undefined;
          } catch {
            body = undefined;
          }
          resolve({ statusCode: response.statusCode || 0, body, rawBody });
        });
      },
    );

    request.on("error", (error) => {
      reject(new Error(`Submission request failed: ${error.message}`));
    });
    request.write(payload);
    request.end();
  });
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

module.exports = {
  activate,
  deactivate,
};
