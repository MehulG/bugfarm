import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sqlite3 from "sqlite3";
import type {
  AssessmentValidation,
  GenerateAssessmentRequest,
  GenerateAssessmentSuccess,
} from "../assessment/types.js";
import { config } from "../config.js";
import {
  DEFAULT_COMPANY_ID,
  type CompanyAssignmentRecord,
  type CompanyAssignmentStatus,
  type CompanyCandidate,
  type CompanyCandidateListRow,
  type CreateCompanyAssignmentInput,
  type CreateCompanyCandidateInput,
} from "./types.js";

type CandidateRow = {
  candidate_id: string;
  company_id: string;
  name: string;
  designation: string;
  github_repo: string | null;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  assignment_record_id: string;
  candidate_id: string;
  company_id: string;
  generation_job_id: string | null;
  status: CompanyAssignmentStatus;
  repo_path: string;
  difficulty: string;
  area: string | null;
  language: string | null;
  bug_count: number;
  role: string | null;
  assessment_name: string | null;
  assessment_id: string | null;
  candidate_launch_url: string | null;
  artifact_path: string | null;
  candidate_repo_path: string | null;
  baseline_repo_path: string | null;
  hidden_tests_path: string | null;
  bug_report_path: string | null;
  task_path: string | null;
  patch_path: string | null;
  summary: string | null;
  files_changed_json: string | null;
  validation_json: string | null;
  orchestration_json: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type CandidateListRow = CandidateRow & {
  assignment_record_id: string | null;
  assignment_status: CompanyAssignmentStatus | null;
  assessment_id: string | null;
  submission_id: string | null;
};

export class CompanyStore {
  private db?: sqlite3.Database;
  private initPromise?: Promise<void>;

  constructor(private readonly dbPath = config.databasePath) {}

  async createCandidate(input: CreateCompanyCandidateInput & { companyId?: string }): Promise<CompanyCandidate> {
    await this.init();
    const now = new Date().toISOString();
    const candidate: CompanyCandidate = {
      candidateId: makeId("cand"),
      companyId: input.companyId ?? DEFAULT_COMPANY_ID,
      name: input.name.trim(),
      designation: input.designation.trim(),
      githubRepo: cleanOptional(input.githubRepo),
      createdAt: now,
      updatedAt: now,
    };

    await this.run(
      `INSERT INTO candidates (
        candidate_id,
        company_id,
        name,
        designation,
        github_repo,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        candidate.candidateId,
        candidate.companyId,
        candidate.name,
        candidate.designation,
        candidate.githubRepo ?? null,
        candidate.createdAt,
        candidate.updatedAt,
      ],
    );

    return candidate;
  }

  async listCandidates(companyId = DEFAULT_COMPANY_ID): Promise<CompanyCandidateListRow[]> {
    await this.init();
    const rows = await this.all<CandidateListRow>(
      `SELECT
         c.*,
         a.assignment_record_id,
         a.status AS assignment_status,
         a.assessment_id,
         s.submission_id
       FROM candidates c
       LEFT JOIN candidate_assignments a
         ON a.assignment_record_id = (
           SELECT ca.assignment_record_id
           FROM candidate_assignments ca
           WHERE ca.candidate_id = c.candidate_id
             AND ca.company_id = c.company_id
           ORDER BY ca.created_at DESC
           LIMIT 1
         )
       LEFT JOIN candidate_submissions s
         ON s.submission_id = (
           SELECT cs.submission_id
           FROM candidate_submissions cs
           WHERE cs.assessment_id = a.assessment_id
           ORDER BY cs.submitted_at DESC
           LIMIT 1
         )
       WHERE c.company_id = ?
       ORDER BY c.created_at DESC`,
      [companyId],
    );

    return rows.map((row) => ({
      candidateId: row.candidate_id,
      name: row.name,
      designation: row.designation,
      githubRepo: row.github_repo ?? undefined,
      assignmentGenerated: row.assignment_status === "succeeded" && Boolean(row.assessment_id),
      assignmentSubmitted: Boolean(row.submission_id),
      assignmentStatus: row.assignment_status ?? undefined,
      assignmentRecordId: row.assignment_record_id ?? undefined,
      assessmentId: row.assessment_id ?? undefined,
      submissionId: row.submission_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async findCandidate(candidateId: string, companyId = DEFAULT_COMPANY_ID): Promise<CompanyCandidate | undefined> {
    await this.init();
    const row = await this.get<CandidateRow>(
      "SELECT * FROM candidates WHERE candidate_id = ? AND company_id = ?",
      [candidateId, companyId],
    );
    return row ? rowToCandidate(row) : undefined;
  }

  async createAssignment(input: {
    candidate: CompanyCandidate;
    request: CreateCompanyAssignmentInput;
  }): Promise<CompanyAssignmentRecord> {
    await this.init();
    const now = new Date().toISOString();
    const record: CompanyAssignmentRecord = {
      assignmentRecordId: makeId("asgn"),
      candidateId: input.candidate.candidateId,
      companyId: input.candidate.companyId,
      status: "queued",
      repoPath: input.request.repoPath,
      difficulty: input.request.difficulty ?? "medium",
      area: cleanOptional(input.request.area),
      language: cleanOptional(input.request.language),
      bugCount: input.request.bugCount ?? input.request.numberOfBugs ?? 1,
      role: cleanOptional(input.request.role),
      assessmentName: cleanOptional(input.request.assessmentName),
      filesChanged: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.run(
      `INSERT INTO candidate_assignments (
        assignment_record_id,
        candidate_id,
        company_id,
        status,
        repo_path,
        difficulty,
        area,
        language,
        bug_count,
        role,
        assessment_name,
        files_changed_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.assignmentRecordId,
        record.candidateId,
        record.companyId,
        record.status,
        record.repoPath,
        record.difficulty,
        record.area ?? null,
        record.language ?? null,
        record.bugCount,
        record.role ?? null,
        record.assessmentName ?? null,
        JSON.stringify(record.filesChanged),
        record.createdAt,
        record.updatedAt,
      ],
    );

    if (input.request.repoPath !== input.candidate.githubRepo) {
      await this.updateCandidateGithubRepo({
        candidateId: input.candidate.candidateId,
        companyId: input.candidate.companyId,
        githubRepo: input.request.repoPath,
      });
    }

    return record;
  }

  async setAssignmentJobId(input: {
    assignmentRecordId: string;
    companyId?: string;
    generationJobId: string;
  }): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE candidate_assignments
       SET generation_job_id = ?, updated_at = ?
       WHERE assignment_record_id = ? AND company_id = ?`,
      [
        input.generationJobId,
        new Date().toISOString(),
        input.assignmentRecordId,
        input.companyId ?? DEFAULT_COMPANY_ID,
      ],
    );
  }

  async markAssignmentRunning(input: {
    assignmentRecordId: string;
    companyId?: string;
  }): Promise<void> {
    await this.init();
    const now = new Date().toISOString();
    await this.run(
      `UPDATE candidate_assignments
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, error_text = NULL
       WHERE assignment_record_id = ? AND company_id = ?`,
      [now, now, input.assignmentRecordId, input.companyId ?? DEFAULT_COMPANY_ID],
    );
  }

  async markAssignmentSucceeded(input: {
    assignmentRecordId: string;
    companyId?: string;
    result: GenerateAssessmentSuccess;
  }): Promise<void> {
    await this.init();
    const now = new Date().toISOString();
    const result = input.result;
    await this.run(
      `UPDATE candidate_assignments
       SET status = 'succeeded',
           assessment_id = ?,
           assessment_name = ?,
           candidate_launch_url = ?,
           artifact_path = ?,
           candidate_repo_path = ?,
           baseline_repo_path = ?,
           hidden_tests_path = ?,
           bug_report_path = ?,
           task_path = ?,
           patch_path = ?,
           summary = ?,
           files_changed_json = ?,
           validation_json = ?,
           orchestration_json = ?,
           error_text = NULL,
           completed_at = ?,
           updated_at = ?
       WHERE assignment_record_id = ? AND company_id = ?`,
      [
        result.assessmentId,
        result.assessmentName,
        result.candidateLaunchUrl,
        result.artifactPath,
        result.candidateRepoPath,
        result.baselineRepoPath,
        result.hiddenTestsPath,
        result.bugReportPath,
        result.taskPath,
        result.patchPath,
        result.summary,
        JSON.stringify(result.filesChanged),
        JSON.stringify(result.validation),
        JSON.stringify(result.orchestration ?? null),
        now,
        now,
        input.assignmentRecordId,
        input.companyId ?? DEFAULT_COMPANY_ID,
      ],
    );
  }

  async markAssignmentFailed(input: {
    assignmentRecordId: string;
    companyId?: string;
    errorText: string;
  }): Promise<void> {
    await this.init();
    const now = new Date().toISOString();
    await this.run(
      `UPDATE candidate_assignments
       SET status = 'failed', error_text = ?, completed_at = ?, updated_at = ?
       WHERE assignment_record_id = ? AND company_id = ?`,
      [
        input.errorText,
        now,
        now,
        input.assignmentRecordId,
        input.companyId ?? DEFAULT_COMPANY_ID,
      ],
    );
  }

  async listAssignmentsForCandidate(input: {
    candidateId: string;
    companyId?: string;
  }): Promise<CompanyAssignmentRecord[]> {
    await this.init();
    const rows = await this.all<AssignmentRow>(
      `SELECT *
       FROM candidate_assignments
       WHERE candidate_id = ? AND company_id = ?
       ORDER BY created_at DESC`,
      [input.candidateId, input.companyId ?? DEFAULT_COMPANY_ID],
    );
    return rows.map(rowToAssignment);
  }

  async findAssignment(input: {
    assignmentRecordId: string;
    candidateId?: string;
    companyId?: string;
  }): Promise<CompanyAssignmentRecord | undefined> {
    await this.init();
    const params: unknown[] = [input.assignmentRecordId, input.companyId ?? DEFAULT_COMPANY_ID];
    const candidateClause = input.candidateId ? " AND candidate_id = ?" : "";
    if (input.candidateId) {
      params.push(input.candidateId);
    }

    const row = await this.get<AssignmentRow>(
      `SELECT *
       FROM candidate_assignments
       WHERE assignment_record_id = ? AND company_id = ?${candidateClause}
       LIMIT 1`,
      params,
    );
    return row ? rowToAssignment(row) : undefined;
  }

  private async updateCandidateGithubRepo(input: {
    candidateId: string;
    companyId: string;
    githubRepo: string;
  }): Promise<void> {
    await this.run(
      `UPDATE candidates
       SET github_repo = ?, updated_at = ?
       WHERE candidate_id = ? AND company_id = ?`,
      [input.githubRepo, new Date().toISOString(), input.candidateId, input.companyId],
    );
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
      CREATE TABLE IF NOT EXISTS candidates (
        candidate_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        designation TEXT NOT NULL,
        github_repo TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidates_company_created ON candidates (company_id, created_at)",
    );

    await this.run(`
      CREATE TABLE IF NOT EXISTS candidate_assignments (
        assignment_record_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        generation_job_id TEXT,
        status TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        area TEXT,
        language TEXT,
        bug_count INTEGER NOT NULL,
        role TEXT,
        assessment_name TEXT,
        assessment_id TEXT,
        candidate_launch_url TEXT,
        artifact_path TEXT,
        candidate_repo_path TEXT,
        baseline_repo_path TEXT,
        hidden_tests_path TEXT,
        bug_report_path TEXT,
        task_path TEXT,
        patch_path TEXT,
        summary TEXT,
        files_changed_json TEXT,
        validation_json TEXT,
        orchestration_json TEXT,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY(candidate_id) REFERENCES candidates(candidate_id)
      )
    `);
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_assignments_candidate_created ON candidate_assignments (candidate_id, company_id, created_at)",
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_candidate_assignments_assessment ON candidate_assignments (assessment_id)",
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
        git_branch TEXT,
        git_baseline_commit TEXT,
        git_submitted_commit TEXT,
        git_changed_files_json TEXT,
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
      throw new Error("Company database is not initialized");
    }
    return this.db;
  }
}

function rowToCandidate(row: CandidateRow): CompanyCandidate {
  return {
    candidateId: row.candidate_id,
    companyId: row.company_id,
    name: row.name,
    designation: row.designation,
    githubRepo: row.github_repo ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAssignment(row: AssignmentRow): CompanyAssignmentRecord {
  return {
    assignmentRecordId: row.assignment_record_id,
    candidateId: row.candidate_id,
    companyId: row.company_id,
    generationJobId: row.generation_job_id ?? undefined,
    status: row.status,
    repoPath: row.repo_path,
    difficulty: row.difficulty,
    area: row.area ?? undefined,
    language: row.language ?? undefined,
    bugCount: row.bug_count,
    role: row.role ?? undefined,
    assessmentName: row.assessment_name ?? undefined,
    assessmentId: row.assessment_id ?? undefined,
    candidateLaunchUrl: row.candidate_launch_url ?? undefined,
    artifactPath: row.artifact_path ?? undefined,
    candidateRepoPath: row.candidate_repo_path ?? undefined,
    baselineRepoPath: row.baseline_repo_path ?? undefined,
    hiddenTestsPath: row.hidden_tests_path ?? undefined,
    bugReportPath: row.bug_report_path ?? undefined,
    taskPath: row.task_path ?? undefined,
    patchPath: row.patch_path ?? undefined,
    summary: row.summary ?? undefined,
    filesChanged: parseJson(row.files_changed_json, []),
    validation: parseJson<AssessmentValidation | undefined>(row.validation_json, undefined),
    orchestration: parseJson<GenerateAssessmentSuccess["orchestration"] | undefined>(
      row.orchestration_json,
      undefined,
    ),
    errorText: row.error_text ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export const companyStore = new CompanyStore();
