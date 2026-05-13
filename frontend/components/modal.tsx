"use client";

import { X } from "lucide-react";

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
};

export function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close" title="Close">
            <X size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
