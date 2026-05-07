import test from "node:test";
import assert from "node:assert/strict";
import { handleAiChatCompletions, handleAiModels } from "../ai/proxy.js";
import { CandidateSessionStore } from "../candidate/store.js";
import { hashToken } from "../candidate/tokens.js";

const testAiConfig = {
  aiProxyEnabled: true,
  aiUpstreamBaseUrl: "https://ai-upstream.example.com/v1",
  aiUpstreamApiKey: "upstream-secret",
  aiUpstreamModel: "gpt-test",
  aiPublicModelName: "codesheep-ai",
  aiSessionRequestLimit: 10,
};

test("AI models endpoint validates scoped token and hides upstream model", async () => {
  const { store, aiToken } = await provisionedStore();
  const response = mockResponse();

  await handleAiModels(
    mockRequest({ authorization: `Bearer ${aiToken}` }),
    response as never,
    {
      store,
      config: testAiConfig,
    },
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.jsonBody, {
    object: "list",
    data: [
      {
        id: "codesheep-ai",
        object: "model",
        created: 0,
        owned_by: "codesheep",
      },
    ],
  });
});

test("AI proxy rejects expired and invalid tokens", async () => {
  const { store, aiToken } = await provisionedStore({ ttlMs: -1 });
  const expiredResponse = mockResponse();
  await handleAiModels(
    mockRequest({ authorization: `Bearer ${aiToken}` }),
    expiredResponse as never,
    {
      store,
      config: testAiConfig,
    },
  );
  assert.equal(expiredResponse.statusCode, 403);
  assert.match(JSON.stringify(expiredResponse.jsonBody), /expired/);

  const invalidResponse = mockResponse();
  await handleAiModels(
    mockRequest({ authorization: "Bearer wrong-token" }),
    invalidResponse as never,
    {
      store,
      config: testAiConfig,
    },
  );
  assert.equal(invalidResponse.statusCode, 403);
});

test("AI chat proxy forwards with upstream auth, overrides model, and audits transcript", async () => {
  const { store, aiToken, sessionId } = await provisionedStore();
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const response = mockResponse();

  await handleAiChatCompletions(
    mockRequest({
      authorization: `Bearer ${aiToken}`,
      body: {
        model: "candidate-selected-expensive-model",
        messages: [{ role: "user", content: "hello" }],
      },
    }),
    response as never,
    {
      store,
      config: testAiConfig,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }) as typeof fetch,
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].url, "https://ai-upstream.example.com/v1/chat/completions");
  assert.equal(calls[0].headers.get("authorization"), "Bearer upstream-secret");
  assert.equal(calls[0].body.model, "gpt-test");
  assert.notEqual(calls[0].headers.get("authorization"), `Bearer ${aiToken}`);

  const latest = await store.getLatestAiProxyRequest(sessionId);
  assert(latest);
  assert.equal(latest.status, "succeeded");
  assert.equal(latest.providerStatus, 200);
  assert.match(latest.requestJson, /gpt-test/);
  assert.match(latest.responseBody ?? "", /hi/);
});

test("AI chat proxy enforces per-session quota before calling upstream", async () => {
  const { store, aiToken, sessionId } = await provisionedStore();
  await store.recordAiProxyRequest({
    sessionId,
    assessmentId: "assessment-123",
    model: "gpt-test",
    requestJson: "{}",
    responseBody: "{}",
    status: "succeeded",
    providerStatus: 200,
  });
  const response = mockResponse();
  let fetchCalled = false;

  await handleAiChatCompletions(
    mockRequest({
      authorization: `Bearer ${aiToken}`,
      body: {
        messages: [{ role: "user", content: "hello" }],
      },
    }),
    response as never,
    {
      store,
      config: {
        ...testAiConfig,
        aiSessionRequestLimit: 1,
      },
      fetch: (async () => {
        fetchCalled = true;
        return new Response("{}");
      }) as typeof fetch,
    },
  );

  assert.equal(response.statusCode, 429);
  assert.equal(fetchCalled, false);
});

test("AI chat proxy streams upstream responses and audits streamed body", async () => {
  const { store, aiToken, sessionId } = await provisionedStore();
  const response = mockResponse();

  await handleAiChatCompletions(
    mockRequest({
      authorization: `Bearer ${aiToken}`,
      body: {
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    }),
    response as never,
    {
      store,
      config: testAiConfig,
      fetch: (async () => {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: one\n\n"));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
            },
          },
        );
      }) as typeof fetch,
    },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream");
  assert.match(response.written.join(""), /data: one/);

  const latest = await store.getLatestAiProxyRequest(sessionId);
  assert(latest);
  assert.match(latest.responseBody ?? "", /data: \[DONE\]/);
});

async function provisionedStore(input: { ttlMs?: number } = {}) {
  const store = new CandidateSessionStore(":memory:", "https://backend.example.com");
  const created = await store.createPendingSession({
    assessmentId: "assessment-123",
    artifactPath: "/tmp/artifact",
    ttlMs: input.ttlMs,
  });
  const aiToken = "ai-token";
  await store.markProvisioned({
    sessionId: created.record.sessionId,
    artifactTokenHash: hashToken("artifact-token"),
    aiTokenHash: hashToken(aiToken),
    submitTokenHash: hashToken("submit-token"),
    coderUserId: "user-id",
    coderUsername: "candidate-abc",
    coderWorkspaceId: "workspace-id",
    coderWorkspaceName: "assess-abc",
  });

  return {
    store,
    aiToken,
    sessionId: created.record.sessionId,
  };
}

function mockRequest(input: {
  authorization?: string;
  body?: unknown;
}) {
  return {
    body: input.body ?? {},
    header(name: string) {
      return name.toLowerCase() === "authorization" ? input.authorization : undefined;
    },
  } as never;
}

function mockResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: undefined as unknown,
    sentBody: undefined as unknown,
    written: [] as string[],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
    send(body: unknown) {
      this.sentBody = body;
      return this;
    },
    write(chunk: Buffer | string) {
      this.written.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
      return true;
    },
    end() {
      return this;
    },
  };

  return response;
}
