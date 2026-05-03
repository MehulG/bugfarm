import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  port: number;
  cursorApiKey?: string;
  modelName: string;
  repoScanMaxFiles: number;
  repoScanMaxChars: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config: AppConfig = {
  port: numberFromEnv("PORT", 3000),
  cursorApiKey: process.env.CURSOR_API_KEY,
  modelName: process.env.MODEL_NAME || "default",
  repoScanMaxFiles: numberFromEnv("REPO_SCAN_MAX_FILES", 40),
  repoScanMaxChars: numberFromEnv("REPO_SCAN_MAX_CHARS", 150000),
};
