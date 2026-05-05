import type { Request, Response as ExpressResponse } from "express";
import { config, type AppConfig } from "../config.js";
import {
  candidateSessionStore,
  type CandidateSessionRecord,
  type CandidateSessionStore,
} from "../candidate/store.js";

type AiProxyConfig = Pick<
  AppConfig,
  | "aiProxyEnabled"
  | "aiUpstreamBaseUrl"
  | "aiUpstreamApiKey"
  | "aiUpstreamModel"
  | "aiPublicModelName"
  | "aiSessionRequestLimit"
>;

type AiProxyOptions = {
  store?: CandidateSessionStore;
  config?: AiProxyConfig;
  fetch?: typeof fetch;
};

type AiAuthResult =
  | {
      ok: true;
      record: CandidateSessionRecord;
    }
  | {
      ok: false;
      statusCode: number;
      message: string;
    };

export async function handleAiModels(
  req: Request,
  res: ExpressResponse,
  options: AiProxyOptions = {},
): Promise<void> {
  const aiConfig = options.config ?? config;
  const auth = await validateAiProxyAuth({
    token: parseBearerToken(req.header("authorization")),
    store: options.store ?? candidateSessionStore,
    config: aiConfig,
    consumeQuota: false,
  });

  if (!auth.ok) {
    res.status(auth.statusCode).json({ error: { message: auth.message } });
    return;
  }

  res.json({
    object: "list",
    data: [
      {
        id: aiConfig.aiPublicModelName,
        object: "model",
        created: 0,
        owned_by: "bugfarm",
      },
    ],
  });
}

export async function handleAiChatCompletions(
  req: Request,
  res: ExpressResponse,
  options: AiProxyOptions = {},
): Promise<void> {
  const aiConfig = options.config ?? config;
  const store = options.store ?? candidateSessionStore;
  const auth = await validateAiProxyAuth({
    token: parseBearerToken(req.header("authorization")),
    store,
    config: aiConfig,
    consumeQuota: true,
  });

  if (!auth.ok) {
    res.status(auth.statusCode).json({ error: { message: auth.message } });
    return;
  }

  if (!aiConfig.aiUpstreamApiKey) {
    res.status(503).json({ error: { message: "AI upstream API key is not configured" } });
    return;
  }

  if (!aiConfig.aiUpstreamModel) {
    res.status(503).json({ error: { message: "AI upstream model is not configured" } });
    return;
  }

  const upstreamFetch = options.fetch ?? fetch;
  const upstreamUrl = `${aiConfig.aiUpstreamBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const upstreamBody = {
    ...(isRecord(req.body) ? req.body : {}),
    model: aiConfig.aiUpstreamModel,
  };
  const requestJson = JSON.stringify(upstreamBody);

  try {
    const upstreamResponse = await upstreamFetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Accept": req.body?.stream === true ? "text/event-stream" : "application/json",
        "Authorization": `Bearer ${aiConfig.aiUpstreamApiKey}`,
        "Content-Type": "application/json",
      },
      body: requestJson,
    });

    if (req.body?.stream === true) {
      const responseBody = await streamUpstreamResponse(upstreamResponse, res);
      await store.recordAiProxyRequest({
        sessionId: auth.record.sessionId,
        assessmentId: auth.record.assessmentId,
        model: aiConfig.aiUpstreamModel,
        requestJson,
        responseBody,
        status: upstreamResponse.ok ? "succeeded" : "failed",
        providerStatus: upstreamResponse.status,
      });
      return;
    }

    const responseBody = await upstreamResponse.text();
    res.status(upstreamResponse.status);
    copyResponseHeaders(upstreamResponse, res);
    res.send(responseBody);

    await store.recordAiProxyRequest({
      sessionId: auth.record.sessionId,
      assessmentId: auth.record.assessmentId,
      model: aiConfig.aiUpstreamModel,
      requestJson,
      responseBody,
      status: upstreamResponse.ok ? "succeeded" : "failed",
      providerStatus: upstreamResponse.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI upstream request failed";
    await store.recordAiProxyRequest({
      sessionId: auth.record.sessionId,
      assessmentId: auth.record.assessmentId,
      model: aiConfig.aiUpstreamModel,
      requestJson,
      status: "failed",
      errorText: message,
    });
    res.status(502).json({ error: { message } });
  }
}

async function validateAiProxyAuth(input: {
  token?: string;
  store: CandidateSessionStore;
  config: AiProxyConfig;
  consumeQuota: boolean;
}): Promise<AiAuthResult> {
  if (!input.config.aiProxyEnabled) {
    return {
      ok: false,
      statusCode: 403,
      message: "AI proxy is disabled",
    };
  }

  if (!input.token) {
    return {
      ok: false,
      statusCode: 401,
      message: "AI proxy authorization is required",
    };
  }

  const record = await input.store.findAiSessionByToken(input.token);
  if (!record) {
    return {
      ok: false,
      statusCode: 403,
      message: "Invalid AI proxy token",
    };
  }

  if (record.status !== "provisioned") {
    return {
      ok: false,
      statusCode: 403,
      message: "AI proxy token is not active",
    };
  }

  if (Date.parse(record.expiresAt) <= Date.now()) {
    return {
      ok: false,
      statusCode: 403,
      message: "AI proxy token expired",
    };
  }

  if (input.consumeQuota) {
    const used = await input.store.countAiProxyRequests(record.sessionId);
    if (used >= input.config.aiSessionRequestLimit) {
      return {
        ok: false,
        statusCode: 429,
        message: "AI proxy request quota exceeded",
      };
    }
  }

  return {
    ok: true,
    record,
  };
}

async function streamUpstreamResponse(upstreamResponse: Response, res: ExpressResponse): Promise<string> {
  res.status(upstreamResponse.status);
  copyResponseHeaders(upstreamResponse, res);

  if (!upstreamResponse.body) {
    res.end();
    return "";
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let responseBody = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    responseBody += decoder.decode(value, { stream: true });
    res.write(Buffer.from(value));
  }

  responseBody += decoder.decode();
  res.end();
  return responseBody;
}

function copyResponseHeaders(upstreamResponse: Response, res: ExpressResponse): void {
  const allowedHeaders = ["content-type", "cache-control"];
  for (const header of allowedHeaders) {
    const value = upstreamResponse.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }
}

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
