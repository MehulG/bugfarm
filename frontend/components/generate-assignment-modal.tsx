"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/modal";
import type { AssignmentDifficulty, CandidateListRow } from "@/lib/types";

type GenerateAssignmentModalProps = {
  candidate: CandidateListRow;
  onClose: () => void;
  onGenerate: (
    candidateId: string,
    input: {
      repoPath: string;
      difficulty: AssignmentDifficulty;
      area?: string;
      language?: string;
      bugCount: number;
    },
  ) => Promise<void>;
};

export function GenerateAssignmentModal({ candidate, onClose, onGenerate }: GenerateAssignmentModalProps) {
  const [repo, setRepo] = useState(candidate.githubRepo ?? "");
  const [difficulty, setDifficulty] = useState<AssignmentDifficulty>("medium");
  const [area, setArea] = useState("");
  const [language, setLanguage] = useState("");
  const [bugCount, setBugCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repo.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onGenerate(candidate.candidateId, {
        repoPath: repo.trim(),
        difficulty,
        area: area.trim() || undefined,
        language: language.trim() || undefined,
        bugCount,
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to generate assignment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Generate assignment for ${candidate.name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Difficulty *</span>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as AssignmentDifficulty)} required>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <label>
          <span>GitHub repo *</span>
          <input
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="github.com/org/repo"
            required
          />
        </label>
        <div className="form-row">
          <label>
            <span>Area</span>
            <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="auth" />
          </label>
          <label>
            <span>Language</span>
            <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="typescript" />
          </label>
        </div>
        <label>
          <span>Bug count</span>
          <input
            type="number"
            min="1"
            max="10"
            value={bugCount}
            onChange={(event) => setBugCount(Number(event.target.value))}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={submitting}>
            Start generation
          </button>
        </footer>
      </form>
    </Modal>
  );
}
