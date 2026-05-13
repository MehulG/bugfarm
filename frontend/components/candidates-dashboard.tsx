"use client";

import Link from "next/link";
import { MouseEvent, useEffect, useState } from "react";
import { ArrowUpRight, Plus, RefreshCcw } from "lucide-react";
import { AddCandidateModal } from "@/components/add-candidate-modal";
import { GenerateAssignmentModal } from "@/components/generate-assignment-modal";
import { StatusPill } from "@/components/status-pill";
import {
  createCandidate,
  generateAssignment,
  listCandidates,
} from "@/lib/api";
import type { CandidateListRow, GenerateAssignmentInput } from "@/lib/types";

export function CandidatesDashboard() {
  const [candidates, setCandidates] = useState<CandidateListRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [generationCandidate, setGenerationCandidate] = useState<CandidateListRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshCandidates() {
    setError(null);
    const rows = await listCandidates();
    setCandidates(rows);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCandidates() {
      try {
        const rows = await listCandidates();
        if (!cancelled) {
          setCandidates(rows);
          setError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Failed to load candidates");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, []);

  function stopRowNavigation(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleCreate(input: { name: string; designation: string; githubRepo?: string }) {
    await createCandidate(input);
    await refreshCandidates();
  }

  async function handleGenerate(candidateId: string, input: GenerateAssignmentInput) {
    await generateAssignment(candidateId, input);
    await refreshCandidates();
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company workspace</p>
          <h1>Candidates</h1>
        </div>
        <button className="button primary" type="button" onClick={() => setShowAdd(true)}>
          <Plus size={14} />
          Add candidate
        </button>
      </header>

      <section className="table-panel" aria-label="Candidate list">
        <div className="table-toolbar">
          <span>{candidates.length} candidates</span>
          <span>{loading ? "Loading" : "Live API data"}</span>
        </div>
        {error ? <div className="empty-state">{error}</div> : null}
        <div className="data-table" role="table">
          <div className="table-row table-head" role="row">
            <span role="columnheader">Candidate name</span>
            <span role="columnheader">Designation</span>
            <span role="columnheader">Assignment generated</span>
            <span role="columnheader">Assignment submitted</span>
            <span role="columnheader">Action</span>
          </div>
          {candidates.map((candidate) => {
            const rowContent = (
              <>
                <span className="candidate-cell">
                  <span>{candidate.name}</span>
                  {candidate.githubRepo ? <small>{candidate.githubRepo}</small> : <small>No repo attached</small>}
                </span>
                <span>{candidate.designation}</span>
                <span>
                  <StatusPill
                    state={candidate.assignmentGenerated ? "yes" : candidate.assignmentStatus ? "pending" : "no"}
                    label={candidate.assignmentStatus ?? undefined}
                  />
                </span>
                <span>
                  <StatusPill
                    state={candidate.assignmentSubmitted ? "yes" : "no"}
                    label={candidate.assignmentSubmitted ? "Submitted" : "Missing"}
                  />
                </span>
                <span className="row-actions">
                  {candidate.assignmentRecordId ? (
                    <span className="inline-action">
                      View
                      <ArrowUpRight size={12} />
                    </span>
                  ) : (
                    <button
                      className="button compact"
                      type="button"
                      onClick={(event) => {
                        stopRowNavigation(event);
                        setGenerationCandidate(candidate);
                      }}
                    >
                      <RefreshCcw size={12} />
                      Generate
                    </button>
                  )}
                </span>
              </>
            );

            return candidate.assignmentRecordId ? (
              <Link className="table-row clickable" role="row" href={`/candidate/${candidate.candidateId}`} key={candidate.candidateId}>
                {rowContent}
              </Link>
            ) : (
              <div className="table-row" role="row" key={candidate.candidateId}>
                {rowContent}
              </div>
            );
          })}
        </div>
      </section>

      {showAdd ? <AddCandidateModal onClose={() => setShowAdd(false)} onCreate={handleCreate} /> : null}
      {generationCandidate ? (
        <GenerateAssignmentModal
          candidate={generationCandidate}
          onClose={() => setGenerationCandidate(null)}
          onGenerate={handleGenerate}
        />
      ) : null}
    </div>
  );
}
