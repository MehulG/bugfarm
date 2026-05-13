"use client";

import { FormEvent, useState } from "react";
import { Modal } from "@/components/modal";

type AddCandidateModalProps = {
  onClose: () => void;
  onCreate: (input: { name: string; designation: string; githubRepo?: string }) => Promise<void>;
};

export function AddCandidateModal({ onClose, onCreate }: AddCandidateModalProps) {
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !designation.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        designation: designation.trim(),
        githubRepo: githubRepo.trim() || undefined,
      });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create candidate");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add candidate" onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </label>
        <label>
          <span>Designation</span>
          <input value={designation} onChange={(event) => setDesignation(event.target.value)} required />
        </label>
        <label>
          <span>GitHub repo</span>
          <input
            value={githubRepo}
            onChange={(event) => setGithubRepo(event.target.value)}
            placeholder="github.com/org/repo"
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <footer className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={submitting}>
            Add candidate
          </button>
        </footer>
      </form>
    </Modal>
  );
}
