"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, GitCommitHorizontal, GitPullRequestArrow, TestTube2 } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { getCandidateDetail } from "@/lib/api";
import type { CandidateDetailResponse } from "@/lib/types";

export function CandidateDetail() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CandidateDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    void getCandidateDetail(params.id)
      .then(setDetail)
      .catch((error) => {
        setError(error instanceof Error ? error.message : "Failed to load candidate");
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading || !detail) {
    return (
      <div className="page-stack">
        <header className="page-header">
          <div>
            <p className="eyebrow">Candidate detail</p>
            <h1>{loading ? "Loading" : "Not found"}</h1>
          </div>
          <Link className="button ghost" href="/candidates">
            <ArrowLeft size={14} />
            Back
          </Link>
        </header>
        <section className="empty-state">
          {loading ? "Loading candidate evidence." : error ?? "Candidate not found."}
        </section>
      </div>
    );
  }

  const candidate = detail.candidate;
  const assignment = detail.currentAssignment;
  const submission = detail.latestSubmission;
  const hiddenTests = submission?.hiddenTestResult;
  const aiUsage = submission?.calculationDetails?.aiUsageSummary;

  async function copyCandidateUrl() {
    if (!assignment?.candidateLaunchUrl) {
      return;
    }
    await navigator.clipboard.writeText(assignment.candidateLaunchUrl);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1600);
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Candidate detail</p>
          <h1>{candidate.name}</h1>
          <p className="subtle">{candidate.designation}</p>
        </div>
        <Link className="button ghost" href="/candidates">
          <ArrowLeft size={14} />
          Back
        </Link>
      </header>

      <section className="detail-grid">
        <article className="metric-strip">
          <span>Assignment</span>
          <StatusPill
            state={assignment?.status === "succeeded" ? "yes" : assignment ? "pending" : "no"}
            label={assignment?.status ?? undefined}
          />
        </article>
        <article className="metric-strip">
          <span>Submission</span>
          <StatusPill
            state={submission?.finalVerdict ? (submission.finalVerdict === "pass" ? "pass" : "fail") : "no"}
            label={submission?.finalVerdict ? submission.finalVerdict.toUpperCase() : "Missing"}
          />
        </article>
        <article className="metric-strip">
          <span>Score</span>
          <strong>{submission?.overallScore !== undefined ? `${submission.overallScore}/100` : "-"}</strong>
        </article>
      </section>

      <section className="split-layout">
        <article className="panel">
          <header className="panel-header">
            <h2>Assignment</h2>
          </header>
          {assignment ? (
            <div className="panel-body">
              <dl className="key-values">
                <div>
                  <dt>Repo</dt>
                  <dd>{assignment.repoPath}</dd>
                </div>
                <div>
                  <dt>Source commit</dt>
                  <dd>{assignment.evidence?.sourceCommit ?? "-"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{assignment.status}</dd>
                </div>
                <div>
                  <dt>Difficulty</dt>
                  <dd>{assignment.difficulty}</dd>
                </div>
                <div>
                  <dt>Bug count</dt>
                  <dd>{assignment.bugCount}</dd>
                </div>
                <div>
                  <dt>Candidate URL</dt>
                  <dd>
                    {assignment.candidateLaunchUrl ? (
                      <span className="copy-value">
                        <span>{assignment.candidateLaunchUrl}</span>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={copyCandidateUrl}
                          aria-label="Copy candidate URL"
                          title={copiedUrl ? "Copied" : "Copy candidate URL"}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    ) : (
                      "-"
                    )}
                  </dd>
                </div>
              </dl>
              <p className="body-copy">{assignment.summary ?? assignment.errorText ?? "Generation is in progress."}</p>
              <div className="file-list">
                {assignment.filesChanged.map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">Assignment has not been generated for this candidate.</div>
          )}
        </article>

        <article className="panel">
          <header className="panel-header">
            <h2>Submission</h2>
          </header>
          {submission ? (
            <div className="panel-body">
              <dl className="key-values">
                <div>
                  <dt>Verdict</dt>
                  <dd>{submission.finalVerdict ?? submission.status}</dd>
                </div>
                <div>
                  <dt>Submitted commit</dt>
                  <dd>{submission.git?.submittedCommit ?? "-"}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{submission.git?.branch ?? "-"}</dd>
                </div>
                <div>
                  <dt>Formula</dt>
                  <dd>{submission.calculationDetails?.scoreFormula ?? "-"}</dd>
                </div>
              </dl>
              <p className="body-copy">{submission.submitNotes}</p>
            </div>
          ) : (
            <div className="empty-state">No candidate submission has been received yet.</div>
          )}
        </article>
      </section>

      {assignment?.evidence?.patchText ? (
        <section className="panel">
          <header className="panel-header">
            <h2>Diffs that caused bugs</h2>
          </header>
          <div className="diff-list">
            <article className="diff-block">
              <header>
                <GitCommitHorizontal size={14} />
                <span>{assignment.patchPath ?? "bug.patch"}</span>
              </header>
              <pre>
                {assignment.evidence.patchText}
                {assignment.evidence.patchTextTruncated ? "\n\n[truncated]" : ""}
              </pre>
            </article>
          </div>
        </section>
      ) : null}

      {assignment?.evidence?.bugReportText ? (
        <section className="panel">
          <header className="panel-header">
            <h2>Bug report</h2>
          </header>
          <div className="diff-list">
            <article className="diff-block">
              <header>
                <GitCommitHorizontal size={14} />
                <span>{assignment.bugReportPath ?? "BUG_REPORT.md"}</span>
              </header>
              <pre>
                {assignment.evidence.bugReportText}
                {assignment.evidence.bugReportTextTruncated ? "\n\n[truncated]" : ""}
              </pre>
            </article>
          </div>
        </section>
      ) : null}

      {detail.assignmentHistory.length > 1 ? (
        <section className="panel">
          <header className="panel-header">
            <h2>Assignment history</h2>
          </header>
          <div className="rubric-grid">
            {detail.assignmentHistory.map((item) => (
              <article className="rubric-row" key={item.assignmentRecordId}>
                <span>{item.assessmentName ?? item.assignmentRecordId}</span>
                <span>{item.status}</span>
                <strong>{item.difficulty}</strong>
                <p>{item.summary ?? item.errorText ?? item.repoPath}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {submission ? (
        <section className="split-layout">
          <article className="panel">
            <header className="panel-header">
              <h2>
                <TestTube2 size={14} />
                Hidden tests
              </h2>
            </header>
            <div className="panel-body">
              <dl className="key-values">
                <div>
                  <dt>Status</dt>
                  <dd>{hiddenTests?.status ?? "-"}</dd>
                </div>
                <div>
                  <dt>Control</dt>
                  <dd>{hiddenTests ? `${hiddenTests.controlPassed}/${hiddenTests.controlTotal}` : "-"}</dd>
                </div>
                <div>
                  <dt>Exposing</dt>
                  <dd>{hiddenTests ? `${hiddenTests.exposingPassed}/${hiddenTests.exposingTotal}` : "-"}</dd>
                </div>
                <div>
                  <dt>Score</dt>
                  <dd>{hiddenTests ? `${hiddenTests.score}/100` : "-"}</dd>
                </div>
              </dl>
            </div>
          </article>

          <article className="panel">
            <header className="panel-header">
              <h2>
                <GitPullRequestArrow size={14} />
                Evaluation params
              </h2>
            </header>
            <div className="panel-body">
              <dl className="key-values">
                <div>
                  <dt>AI requests</dt>
                  <dd>{aiUsage?.requestCount ?? "-"}</dd>
                </div>
                <div>
                  <dt>Prompt tokens</dt>
                  <dd>{aiUsage?.estimatedPromptTokens.toLocaleString() ?? "-"}</dd>
                </div>
                <div>
                  <dt>Completion tokens</dt>
                  <dd>{aiUsage?.estimatedCompletionTokens.toLocaleString() ?? "-"}</dd>
                </div>
              </dl>
              <p className="body-copy">{submission.evaluatorNotes ?? submission.calculationDetails?.evaluatorNotes}</p>
            </div>
          </article>
        </section>
      ) : null}

      {submission?.dimensionScores ? (
        <section className="panel">
          <header className="panel-header">
            <h2>Rubric scores</h2>
          </header>
          <div className="rubric-grid">
            {submission.dimensionScores.map((score) => (
              <article className="rubric-row" key={score.name}>
                <span>{score.name}</span>
                <span>{Math.round(score.weight)}%</span>
                <strong>{score.score}/100</strong>
                <p>{score.reason}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
