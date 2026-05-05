import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  port: number;
  cursorApiKey?: string;
  modelName: string;
  repoScanMaxFiles: number;
  repoScanMaxChars: number;
  assessmentOutputDir: string;
  databasePath: string;
  publicBackendUrl: string;
  coderUrl?: string;
  coderApiUrl?: string;
  coderApiToken?: string;
  coderOrganizationId?: string;
  coderTemplateId?: string;
  coderWorkspaceTtlMs: number;
  aiProxyEnabled: boolean;
  aiUpstreamBaseUrl: string;
  aiUpstreamApiKey?: string;
  aiUpstreamModel?: string;
  aiPublicModelName: string;
  aiSessionRequestLimit: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const config: AppConfig = {
  port: numberFromEnv("PORT", 3000),
  cursorApiKey: process.env.CURSOR_API_KEY,
  modelName: process.env.MODEL_NAME || "default",
  repoScanMaxFiles: numberFromEnv("REPO_SCAN_MAX_FILES", 40),
  repoScanMaxChars: numberFromEnv("REPO_SCAN_MAX_CHARS", 150000),
  assessmentOutputDir: process.env.ASSESSMENT_OUTPUT_DIR || "./artifacts",
  databasePath: process.env.DATABASE_PATH || "./bugfarm.sqlite",
  publicBackendUrl: process.env.PUBLIC_BACKEND_URL || `http://localhost:${numberFromEnv("PORT", 3000)}`,
  coderUrl: process.env.CODER_URL,
  coderApiUrl: process.env.CODER_API_URL || process.env.CODER_URL,
  coderApiToken: process.env.CODER_API_TOKEN,
  coderOrganizationId: process.env.CODER_ORGANIZATION_ID,
  coderTemplateId: process.env.CODER_TEMPLATE_ID,
  coderWorkspaceTtlMs: numberFromEnv("CODER_WORKSPACE_TTL_MS", 14_400_000),
  aiProxyEnabled: booleanFromEnv("AI_PROXY_ENABLED", true),
  aiUpstreamBaseUrl: process.env.AI_UPSTREAM_BASE_URL || "https://api.openai.com/v1",
  aiUpstreamApiKey: process.env.AI_UPSTREAM_API_KEY,
  aiUpstreamModel: process.env.AI_UPSTREAM_MODEL,
  aiPublicModelName: process.env.AI_PUBLIC_MODEL_NAME || "bugfarm-ai",
  aiSessionRequestLimit: numberFromEnv("AI_SESSION_REQUEST_LIMIT", 100),
};
