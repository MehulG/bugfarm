import { mkdir } from "node:fs/promises";
import path from "node:path";
import sqlite3 from "sqlite3";
import { config } from "../config.js";
import { createSecretToken, hashToken, shortId } from "./tokens.js";
import type {
  CandidateEvaluationDimensionScore,
  CandidateEvaluationResult,
  CandidateFinalVerdict,
  CandidateSubmissionStatus,
  SubmissionHiddenTestResult,
} from "../assessment/types.js";

export type CandidateSessionStatus = "pending" | "provisioned" | "failed";

export type CandidateSessionRecord = {
  sessionId: string;
  assessmentId: string;
  artifactHash: string;
  artifactPath: string;
  launchTokenHash: string;
  artifactTokenHash?: string;
  aiTokenHash?: string;
  submitTokenHash?: string;
  coderUserId?: string;
  coderUsername?: string;
  coderWorkspaceId?: string;
  coderWorkspaceName?: string;
  status: CandidateSessionStatus;
  createdAt: string;
  expiresAt: string;
  firstOpenedAt?: string;
  lastError?: string;
};

type CandidateSessionRow = {
  session_id: string;
  assessment_id: string;
  artifact_hash: string;
  artifact_path: string;
  launch_token_hash: string;
  artifact_token_hash: string | null;
  ai_token_hash: string | null;
  submit_token_hash: string | null;
  coder_user_id: string | null;
  coder_username: string | null;
  coder_workspace_id: string | null;
  coder_workspace_name: string | null;
  status: CandidateSessionStatus;
  created_at: string;
  expires_at: string;
  first_opened_at: string | null;
  last_error: string | null;
};

export type AiProxyRequestStatus = "succeeded" | "failed";

export type AiProxyAuditRecord = {
  sessionId: string;
  assessmentId: string;
  model: string;
  requestJson: string;
  responseBody?: string;
  status: AiProxyRequestStatus;
  providerStatus?: number;
  errorText?: string;
};

export type StoredAiProxyRequest = AiProxyAuditRecord & {
  createdAt: string;
  providerStatus?: number;
};

export type CreatedCandidateSession = {
  record: CandidateSessionRecord;
  launchToken: string;
  candidateLaunchUrl: string;
};

type CandidateSubmissionRow = {
  submission_id: string;
  session_id: string;
  assessment_id: string;
  status: CandidateSubmissionStatus;
  submitted_at: string;
  completed_at: string | null;
  submit_notes: string;
  workspace_snapshot_path: string | null;
  hidden_test_result_json: string | null;
  dimension_scores_json: string | null;
  overall_score: number | null;
  final_verdict: CandidateFinalVerdict | null;
  evaluator_notes: string | null;
  workspace_stop_requested_at: string | null;
  error_text: string | null;
};

export class CandidateSessionStore {
  private db?: sqlite3.Database;
  private initPromise?: Promise<void>;

  constructor(
    private readonly dbPath = config.databasePath,
    private readonly publicBackendUrl = config.publicBackendUrl,
  ) {}

  async createPendingSession(input: {
    assessmentId: string;
    artifactPath: string;
    ttlMs?: number;
  }): Promise<CreatedCandidateSession> {
    await this.init();

    const sessionId = createSecretToken(12);
    const launchToken = createSecretToken(32);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000));
    const record: CandidateSessionRecord = {
      sessionId,
      assessmentId: input.assessmentId,
      artifactHash: input.assessmentId,
      artifactPath: input.artifactPath,
      launchTokenHash: hashToken(launchToken),
      status: "pending",
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.run(
      `INSERT INTO candidate_sessions (
        session_id,
        assessment_id,
        artifact_hash,
        artifact_path,
        launch_token_hash,
        status,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.sessionId,
        record.assessmentId,
        record.artifactHash,
        record.artifactPath,
        record.launchTokenHash,
        record.status,
        record.createdAt,
        record.expiresAt,
      ],
    );

    return {
      record,
      launchToken,
      candidateLaunchUrl: `${this.publicBackendUrl.replace(/\/+$/, "")}/candidate/launch/${launchToken}`,
    };
  }

  async findByLaunchToken(launchToken: string): Promise<CandidateSessionRecord | undefined> {
    await this.init();
    const row = await this.get<CandidateSessionRow>(
      "SELECT * FROM candidate_sessions WHERE launch_token_hash = ?",
      [hashToken(launchToken)],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async findArtifactSession(input: {
    artifactHash: string;
    sessionId: string;
  }): Promise<CandidateSessionRecord | undefined> {
    await this.init();
    const row = await this.get<CandidateSessionRow>(
      "SELECT * FROM candidate_sessions WHERE artifact_hash = ? AND session_id = ?",
      [input.artifactHash, input.sessionId],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async findAiSessionByToken(token: string): Promise<CandidateSessionRecord | undefined> {
    await this.init();
    const row = await this.get<CandidateSessionRow>(
      "SELECT * FROM candidate_sessions WHERE ai_token_hash = ?",
      [hashToken(token)],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async findSubmitSessionByToken(token: string): Promise<CandidateSessionRecord | undefined> {
    await this.init();
    const row = await this.get<CandidateSessionRow>(
      "SELECT * FROM candidate_sessions WHERE submit_token_hash = ?",
      [hashToken(token)],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async markProvisioned(input: {
    sessionId: string;
    artifactTokenHash: string;
    aiTokenHash: string;
    submitTokenHash: string;
    coderUserId: string;
    coderUsername: string;
    coderWorkspaceId: string;
    coderWorkspaceName: string;
  }): Promise<void> {
    await this.init();
    const now = new Date().toISOString();
    await this.run(
      `UPDATE candidate_sessions
       SET status = 'provisioned',
           artifact_token_hash = ?,
           ai_token_hash = ?,
           submit_token_hash = ?,
           coder_user_id = ?,
           coder_username = ?,
           coder_workspace_id = ?,
           coder_workspace_name = ?,
           first_opened_at = COALESCE(first_opened_at, ?),
           last_error = NULL
       WHERE session_id = ?`,
      [
        input.artifactTokenHash,
        input.aiTokenHash,
        input.submitTokenHash,
        input.coderUserId,
        input.coderUsername,
        input.coderWorkspaceId,
        input.coderWorkspaceName,
        now,
        input.sessionId,
      ],
    );
  }

  async markFailed(sessionId: string, error: string): Promise<void> {
    await this.init();
    await this.run(
      "UPDATE candidate_sessions SET status = 'failed', last_error = ? WHERE session_id = ?",
      [error, sessionId],
    );
  }

  async resetCoderPassword(input: {
    sessionId: string;
    artifactTokenHash?: string;
  }): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_sessions
       SET artifact_token_hash = COALESCE(?, artifact_token_hash),
           last_error = NULL
       WHERE session_id = ?`,
      [input.artifactTokenHash ?? null, input.sessionId],
    );
  }

  async countAiProxyRequests(sessionId: string): Promise<number> {
    await this.init();
    const row = await this.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM ai_proxy_requests WHERE session_id = ?",
      [sessionId],
    );
    return row?.count ?? 0;
  }

  async recordAiProxyRequest(input: AiProxyAuditRecord): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO ai_proxy_requests (
        session_id,
        assessment_id,
        created_at,
        model,
        request_json,
        response_body,
        status,
        provider_status,
        error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.sessionId,
        input.assessmentId,
        new Date().toISOString(),
        input.model,
        input.requestJson,
        input.responseBody ?? null,
        input.status,
        input.providerStatus ?? null,
        input.errorText ?? null,
      ],
    );
  }

  async getLatestAiProxyRequest(sessionId: string): Promise<StoredAiProxyRequest | undefined> {
    await this.init();
    const row = await this.get<{
      session_id: string;
      assessment_id: string;
      created_at: string;
      model: string;
      request_json: string;
      response_body: string | null;
      status: AiProxyRequestStatus;
      provider_status: number | null;
      error_text: string | null;
    }>(
      `SELECT *
       FROM ai_proxy_requests
       WHERE session_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [sessionId],
    );

    if (!row) {
      return undefined;
    }

    return {
      sessionId: row.session_id,
      assessmentId: row.assessment_id,
      createdAt: row.created_at,
      model: row.model,
      requestJson: row.request_json,
      responseBody: row.response_body ?? undefined,
      status: row.status,
      providerStatus: row.provider_status ?? undefined,
      errorText: row.error_text ?? undefined,
    };
  }

  async createSubmission(input: {
    submissionId: string;
    sessionId: string;
    assessmentId: string;
    submitNotes: string;
  }): Promise<CandidateEvaluationResult> {
    await this.init();
    const submittedAt = new Date().toISOString();

    await this.run(
      `INSERT INTO candidate_submissions (
        submission_id,
        session_id,
        assessment_id,
        status,
        submitted_at,
        submit_notes
      ) VALUES (?, ?, ?, 'queued', ?, ?)`,
      [input.submissionId, input.sessionId, input.assessmentId, submittedAt, input.submitNotes],
    );

    return {
      submissionId: input.submissionId,
      sessionId: input.sessionId,
      assessmentId: input.assessmentId,
      status: "queued",
      submittedAt,
      submitNotes: input.submitNotes,
    };
  }

  async findSubmissionBySessionId(sessionId: string): Promise<CandidateEvaluationResult | undefined> {
    await this.init();
    const row = await this.get<CandidateSubmissionRow>(
      `SELECT *
       FROM candidate_submissions
       WHERE session_id = ?
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [sessionId],
    );
    return row ? rowToSubmission(row) : undefined;
  }

  async findSubmissionBySubmissionId(submissionId: string): Promise<CandidateEvaluationResult | undefined> {
    await this.init();
    const row = await this.get<CandidateSubmissionRow>(
      `SELECT *
       FROM candidate_submissions
       WHERE submission_id = ?
       LIMIT 1`,
      [submissionId],
    );
    return row ? rowToSubmission(row) : undefined;
  }

  async listSubmissions(input: { assessmentId?: string; limit?: number } = {}): Promise<CandidateEvaluationResult[]> {
    await this.init();
    const boundedLimit = Math.min(Math.max(Math.trunc(input.limit ?? 50) || 50, 1), 200);
    const rows = input.assessmentId
      ? await this.all<CandidateSubmissionRow>(
          `SELECT *
           FROM candidate_submissions
           WHERE assessment_id = ?
           ORDER BY submitted_at DESC
           LIMIT ?`,
          [input.assessmentId, boundedLimit],
        )
      : await this.all<CandidateSubmissionRow>(
          `SELECT *
           FROM candidate_submissions
           ORDER BY submitted_at DESC
           LIMIT ?`,
          [boundedLimit],
        );
    return rows.map(rowToSubmission);
  }

  async markSubmissionRunning(input: {
    sessionId: string;
    workspaceSnapshotPath: string;
  }): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_submissions
       SET status = 'running',
           workspace_snapshot_path = ?
       WHERE session_id = ?`,
      [input.workspaceSnapshotPath, input.sessionId],
    );
  }

  async markSubmissionSucceeded(input: {
    sessionId: string;
    hiddenTestResult: SubmissionHiddenTestResult;
    dimensionScores: CandidateEvaluationDimensionScore[];
    overallScore: number;
    finalVerdict: CandidateFinalVerdict;
    evaluatorNotes: string;
  }): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_submissions
       SET status = 'succeeded',
           completed_at = ?,
           hidden_test_result_json = ?,
           dimension_scores_json = ?,
           overall_score = ?,
           final_verdict = ?,
           evaluator_notes = ?,
           error_text = NULL
       WHERE session_id = ?`,
      [
        new Date().toISOString(),
        JSON.stringify(input.hiddenTestResult),
        JSON.stringify(input.dimensionScores),
        input.overallScore,
        input.finalVerdict,
        input.evaluatorNotes,
        input.sessionId,
      ],
    );
  }

  async markSubmissionFailed(input: {
    sessionId: string;
    errorText: string;
    workspaceSnapshotPath?: string;
  }): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_submissions
       SET status = 'failed',
           completed_at = ?,
           workspace_snapshot_path = COALESCE(?, workspace_snapshot_path),
           error_text = ?
       WHERE session_id = ?`,
      [new Date().toISOString(), input.workspaceSnapshotPath ?? null, input.errorText, input.sessionId],
    );
  }

  async markWorkspaceStopRequested(sessionId: string): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_submissions
       SET workspace_stop_requested_at = ?
       WHERE session_id = ?`,
      [new Date().toISOString(), sessionId],
    );
  }

  makeCoderUsername(sessionId: string): string {
    return `candidate-${shortId(sessionId)}`;
  }

  makeWorkspaceName(sessionId: string): string {
    return `assess-${shortId(sessionId)}`;
  }

  private async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.openAndMigrate();
    }
    await this.initPromise;
  }

  private async openAndMigrate(): Promise<void> {
    if (this.dbPath !== ":memory:") {
      await mkdir(path.dirname(path.resolve(this.dbPath)), { recursive: true });
    }

    this.db = await new Promise<sqlite3.Database>((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(db);
      });
    });

    await this.run(`
      CREATE TABLE IF NOT EXISTS candidate_sessions (
        session_id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        launch_token_hash TEXT NOT NULL UNIQUE,
        artifact_token_hash TEXT,
        ai_token_hash TEXT,
        submit_token_hash TEXT,
        coder_user_id TEXT,
        coder_username TEXT,
        coder_workspace_id TEXT,
        coder_workspace_name TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        first_opened_at TEXT,
        last_error TEXT
      )
    `);
    await this.addColumnIfMissing("candidate_sessions", "ai_token_hash", "TEXT");
    await this.addColumnIfMissing("candidate_sessions", "submit_token_hash", "TEXT");
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_sessions_artifact ON candidate_sessions (artifact_hash, session_id)",
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_sessions_ai_token ON candidate_sessions (ai_token_hash)",
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_sessions_submit_token ON candidate_sessions (submit_token_hash)",
    );
    await this.run(`
      CREATE TABLE IF NOT EXISTS ai_proxy_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        assessment_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_body TEXT,
        status TEXT NOT NULL,
        provider_status INTEGER,
        error_text TEXT
      )
    `);
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_ai_proxy_requests_session ON ai_proxy_requests (session_id, created_at)",
    );
    await this.run(`
      CREATE TABLE IF NOT EXISTS candidate_submissions (
        submission_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        assessment_id TEXT NOT NULL,
        status TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        completed_at TEXT,
        submit_notes TEXT NOT NULL,
        workspace_snapshot_path TEXT,
        hidden_test_result_json TEXT,
        dimension_scores_json TEXT,
        overall_score REAL,
        final_verdict TEXT,
        evaluator_notes TEXT,
        workspace_stop_requested_at TEXT,
        error_text TEXT
      )
    `);
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_submissions_assessment ON candidate_submissions (assessment_id, submitted_at)",
    );
  }

  private async addColumnIfMissing(tableName: string, columnName: string, type: string): Promise<void> {
    const columns = await this.all<{ name: string }>(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
      await this.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${type}`);
    }
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.requireDb().run(sql, params, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.requireDb().get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row as T | undefined);
      });
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.requireDb().all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows as T[]);
      });
    });
  }

  private requireDb(): sqlite3.Database {
    if (!this.db) {
      throw new Error("Candidate session database is not initialized");
    }
    return this.db;
  }
}

function rowToRecord(row: CandidateSessionRow): CandidateSessionRecord {
  return {
    sessionId: row.session_id,
    assessmentId: row.assessment_id,
    artifactHash: row.artifact_hash,
    artifactPath: row.artifact_path,
    launchTokenHash: row.launch_token_hash,
    artifactTokenHash: row.artifact_token_hash ?? undefined,
    aiTokenHash: row.ai_token_hash ?? undefined,
    submitTokenHash: row.submit_token_hash ?? undefined,
    coderUserId: row.coder_user_id ?? undefined,
    coderUsername: row.coder_username ?? undefined,
    coderWorkspaceId: row.coder_workspace_id ?? undefined,
    coderWorkspaceName: row.coder_workspace_name ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    firstOpenedAt: row.first_opened_at ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}

export const candidateSessionStore = new CandidateSessionStore();


function rowToSubmission(row: CandidateSubmissionRow): CandidateEvaluationResult {
  return {
    submissionId: row.submission_id,
    sessionId: row.session_id,
    assessmentId: row.assessment_id,
    status: row.status,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at ?? undefined,
    submitNotes: row.submit_notes,
    workspaceSnapshotPath: row.workspace_snapshot_path ?? undefined,
    hiddenTestResult: row.hidden_test_result_json
      ? (JSON.parse(row.hidden_test_result_json) as SubmissionHiddenTestResult)
      : undefined,
    dimensionScores: row.dimension_scores_json
      ? (JSON.parse(row.dimension_scores_json) as CandidateEvaluationDimensionScore[])
      : undefined,
    overallScore: row.overall_score ?? undefined,
    finalVerdict: row.final_verdict ?? undefined,
    evaluatorNotes: row.evaluator_notes ?? undefined,
    workspaceStopRequestedAt: row.workspace_stop_requested_at ?? undefined,
    errorText: row.error_text ?? undefined,
  };
}
