import Link from "next/link";
import { Box, ListChecks } from "lucide-react";

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" href="/candidates" aria-label="Codesheep candidates">
          <Box size={15} />
          <span>Codesheep</span>
        </Link>
        <nav className="nav-list">
          <Link className="nav-item active" href="/candidates">
            <ListChecks size={14} />
            <span>Candidates</span>
          </Link>
        </nav>
      </aside>
      <section className="workspace">{children}</section>
    </main>
  );
}
