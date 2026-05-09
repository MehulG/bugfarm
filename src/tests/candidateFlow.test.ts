import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { CoderClient } from "../candidate/coderClient.js";
import { createCandidateRepoZip } from "../candidate/artifactZip.js";
import { CandidateSessionStore } from "../candidate/store.js";
import { hashToken, tokenMatches } from "../candidate/tokens.js";
import { handleCandidateLaunchStatus } from "../candidate/flow.js";

test("token hashing validates matching tokens only", () => {
  const hash = hashToken("secret-token");

  assert.equal(tokenMatches("secret-token", hash), true);
  assert.equal(tokenMatches("wrong-token", hash), false);
});

test("candidate session store records and detects expired launch sessions", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
    ttlMs: -1,
  });

  const record = await store.findByLaunchToken(created.launchToken);
  assert(record);
  assert.equal(record.assessmentId, "assessment-123");
  assert.equal(Date.parse(record.expiresAt) <= Date.now(), true);
});

test("candidate artifact zip includes repo README instructions and excludes non-candidate folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codesheep-artifact-"));
  await mkdir(path.join(root, "candidate-repo", "src"), { recursive: true });
  await mkdir(path.join(root, "candidate"), { recursive: true });
  await mkdir(path.join(root, "hidden-tests"), { recursive: true });
  await mkdir(path.join(root, "baseline-repo"), { recursive: true });

  await writeFile(path.join(root, "candidate-repo", "README.md"), "Original README\n", "utf8");
  await writeFile(path.join(root, "candidate-repo", "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(root, "candidate", "TASK.md"), "Fix the login bug.\n", "utf8");
  await writeFile(path.join(root, "hidden-tests", "spec.json"), "{}", "utf8");
  await writeFile(path.join(root, "assessment.json"), "{}", "utf8");

  const entries = readZipEntries(await createCandidateRepoZip(root));

  assert.deepEqual(Object.keys(entries).sort(), ["AI_ASSISTANT.md", "README.md", "src/app.ts"]);
  assert.match(entries["README.md"].toString("utf8"), /Fix the login bug/);
  assert.match(entries["README.md"].toString("utf8"), /codesheep-ai/);
  assert.match(entries["README.md"].toString("utf8"), /git commit -m "Complete assessment"/);
  assert.match(entries["AI_ASSISTANT.md"].toString("utf8"), /Cline is preconfigured/);
  assert.match(entries["AI_ASSISTANT.md"].toString("utf8"), /OpenAI Compatible/);
  assert.match(entries["AI_ASSISTANT.md"].toString("utf8"), /`main` branch/);
  assert.match(entries["README.md"].toString("utf8"), /Original README/);
  assert.equal(entries["src/app.ts"].toString("utf8"), "export const value = 1;\n");
});

test("Coder client sends user and workspace creation request shapes", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (String(url).endsWith("/api/v2/users")) {
      return jsonResponse({ id: "user-id", username: "candidate-abc" });
    }

    return jsonResponse({ id: "workspace-id", name: "assess-abc" });
  }) as typeof fetch;

  try {
    const client = new CoderClient({
      publicUrl: "https://coder-public.example.com",
      apiUrl: "https://coder-api.example.com",
      apiToken: "coder-token",
      organizationId: "org-id",
      templateId: "template-id",
      workspaceTtlMs: 14_400_000,
    });

    await client.createUser({
      username: "candidate-abc",
      password: "password",
      email: "candidate-abc@codesheep.local",
      name: "Candidate candidate-abc",
    });
    await client.createWorkspace({
      username: "candidate-abc",
      workspaceName: "assess-abc",
      artifactHash: "assessment-123",
      sessionId: "session-123",
      artifactToken: "artifact-token",
      aiProxyToken: "ai-proxy-token",
      submitToken: "submit-token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0].url, "https://coder-api.example.com/api/v2/users");
  assert.deepEqual(calls[0].body, {
    username: "candidate-abc",
    email: "candidate-abc@codesheep.local",
    name: "Candidate candidate-abc",
    password: "password",
    login_type: "password",
    organization_ids: ["org-id"],
    roles: [],
    service_account: false,
    user_status: "active",
  });
  assert.equal(calls[1].url, "https://coder-api.example.com/api/v2/users/candidate-abc/workspaces");
  assert.deepEqual(calls[1].body, {
    name: "assess-abc",
    template_id: "template-id",
    ttl_ms: 14_400_000,
    automatic_updates: "never",
    rich_parameter_values: [
      { name: "artifact_hash", value: "assessment-123" },
      { name: "session_id", value: "session-123" },
      { name: "artifact_token", value: "artifact-token" },
      { name: "ai_proxy_token", value: "ai-proxy-token" },
      { name: "submit_token", value: "submit-token" },
    ],
  });
});

test("candidate launch is idempotent after workspace provisioning", async () => {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
  });
  const coder = new FakeCoder();

  const firstResponse = mockResponse();
  await handleCandidateLaunchStatus(
    mockRequest(created.launchToken),
    firstResponse as never,
    {
      store,
      coder,
    },
  );
  const secondResponse = mockResponse();
  await handleCandidateLaunchStatus(
    mockRequest(created.launchToken),
    secondResponse as never,
    {
      store,
      coder,
    },
  );

  assert.equal(coder.createUserCalls, 1);
  assert.equal(coder.createWorkspaceCalls, 1);
  assertNoCandidateCredentials(firstResponse.jsonBody);
  assertNoCandidateCredentials(secondResponse.jsonBody);
});

function assertNoCandidateCredentials(value: unknown): void {
  assert(value && typeof value === "object");
  const body = value as Record<string, unknown>;
  assert.equal("coderUsername" in body, false);
  assert.equal("coderEmail" in body, false);
  assert.equal("coderPassword" in body, false);
  assert.equal("aiProxyToken" in body, false);
  assert.equal(body.status, "ready");
  assert.equal(typeof body.codeServerUrl, "string");
  assert.match(body.codeServerUrl as string, /^https:\/\/coder\.example\.com\/@candidate-[a-z0-9]+\/assess-[a-z0-9]+\.main\/apps\/code-server\/$/);
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function mockRequest(launchToken: string) {
  return {
    params: { launchToken },
  } as never;
}

function mockResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(_body: unknown) {
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
  };

  return response;
}

class FakeCoder {
  createUserCalls = 0;
  createWorkspaceCalls = 0;

  async createUser(input: { username: string }) {
    this.createUserCalls += 1;
    return {
      id: "user-id",
      username: input.username,
    };
  }

  async createWorkspace(input: { workspaceName: string }) {
    this.createWorkspaceCalls += 1;
    return {
      id: "workspace-id",
      name: input.workspaceName,
    };
  }

  async updateUserPassword() {}

  workspaceUrl(username: string, workspaceName: string): string {
    return `https://coder.example.com/@${username}/${workspaceName}`;
  }

  codeServerUrl(username: string, workspaceName: string): string {
    return `https://coder.example.com/@${username}/${workspaceName}.main/apps/code-server/`;
  }

  async getWorkspaceReadiness() {
    return {
      status: "ready" as const,
    };
  }

  async stopWorkspace() {}
}

function readZipEntries(zip: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  const endOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOffset, -1);

  const entryCount = zip.readUInt16LE(endOffset + 10);
  let centralOffset = zip.readUInt32LE(endOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries[name] = inflateRawSync(zip.subarray(dataOffset, dataOffset + compressedSize));

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
