const features = [
  {
    title: "Realistic bug seeding",
    body: "Generate candidate repos with focused, non-malicious defects in real codebases.",
  },
  {
    title: "Hidden-test validation",
    body: "Capture baseline behavior, create deterministic checks, and validate assessment quality.",
  },
  {
    title: "Coder workspace launch",
    body: "Provision a private code-server workspace from a candidate launch URL.",
  },
  {
    title: "AI proxy control",
    body: "Route candidate assistant usage through a session-scoped OpenAI-compatible proxy.",
  },
  {
    title: "Submission scoring",
    body: "Evaluate fixes with hidden tests, rubric dimensions, and audit-friendly score details.",
  },
  {
    title: "Artifact isolation",
    body: "Keep reports, rubrics, and hidden tests outside the candidate-facing bundle.",
  },
];

const workflow = [
  "Generate assessment",
  "Launch candidate",
  "Submit workspace",
  "Evaluate fix",
];

const statusRows = [
  ["Assessment", "backend-debugging-screen", "ready"],
  ["Hidden tests", "12 cases validated", "passed"],
  ["Workspace", "code-server provisioned", "active"],
  ["Evaluation", "weighted score pending", "queued"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-black">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a className="flex items-center gap-3" href="#">
            <span className="grid size-8 place-items-center rounded-sm border border-black bg-black text-sm font-semibold text-white">
              CS
            </span>
            <span className="text-sm font-medium tracking-tight">Code Sheep</span>
          </a>
          <div className="hidden items-center gap-7 text-sm text-neutral-600 md:flex">
            <a className="transition hover:text-black" href="#features">
              Features
            </a>
            <a className="transition hover:text-black" href="#workflow">
              Workflow
            </a>
            <a className="transition hover:text-black" href="#get-started">
              Deploy
            </a>
          </div>
          <a
            className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
            href="#get-started"
          >
            Start building
          </a>
        </nav>
      </header>

      <section className="border-b border-black/10">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-[1fr_0.92fr] md:items-center md:py-24">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-neutral-600">
              <span className="size-1.5 rounded-full bg-black" />
              AI coding assessment infrastructure
            </div>
            <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
              Real debugging screens, generated and evaluated end to end.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-neutral-600">
              Code Sheep turns real repositories into candidate-ready debugging
              assessments with seeded bugs, hidden tests, isolated workspaces,
              AI usage controls, and scored submissions.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex h-11 items-center justify-center rounded-sm bg-black px-5 text-sm font-medium text-white transition hover:bg-neutral-800"
                href="#get-started"
              >
                Generate an assessment
              </a>
              <a
                className="inline-flex h-11 items-center justify-center rounded-sm border border-black/15 px-5 text-sm font-medium transition hover:border-black/30 hover:bg-neutral-50"
                href="#workflow"
              >
                View workflow
              </a>
            </div>
          </div>

          <section
            aria-label="Code Sheep product preview"
            className="overflow-hidden rounded-md border border-black/10 bg-neutral-950 text-white shadow-2xl shadow-black/10"
          >
            <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-white/25" />
                <span className="size-2.5 rounded-full bg-white/25" />
                <span className="size-2.5 rounded-full bg-white/25" />
              </div>
              <span className="font-mono text-xs text-white/50">codesheep.run</span>
            </div>
            <div className="grid gap-4 p-4 sm:p-5">
              <div className="rounded-sm border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Assessment pipeline</p>
                    <p className="mt-1 text-xs text-white/50">
                      Repository to scored submission
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                    live
                  </span>
                </div>
                <div className="grid gap-2">
                  {statusRows.map(([label, detail, state]) => (
                    <div
                      className="grid grid-cols-[88px_1fr_auto] items-center gap-3 rounded-sm border border-white/10 bg-black/30 px-3 py-2 text-xs"
                      key={label}
                    >
                      <span className="text-white/50">{label}</span>
                      <span className="min-w-0 truncate font-mono text-white/80">
                        {detail}
                      </span>
                      <span className="text-white/55">{state}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-sm border border-white/10 bg-black p-4 font-mono text-xs leading-6 text-white/70">
                <p>
                  <span className="text-white">POST</span>{" "}
                  /generate-assessment
                </p>
                <p className="text-white/45">
                  {"{"} repoPath, role, difficulty, hiddenTests {"}"}
                </p>
                <p className="mt-3 text-emerald-300">
                  candidateLaunchUrl created
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section id="features" className="border-b border-black/10">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-neutral-500">Platform</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything required to run a credible coding screen.
            </h2>
          </div>
          <div className="mt-10 grid border-y border-black/10 md:grid-cols-3">
            {features.map((feature) => (
              <article
                className="min-h-44 border-black/10 py-6 md:border-r md:px-6 md:[&:nth-child(3n)]:border-r-0 max-md:border-b max-md:last:border-b-0"
                key={feature.title}
              >
                <h3 className="text-base font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-neutral-600">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="border-b border-black/10 bg-neutral-50">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-medium text-neutral-500">Workflow</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                A clean path from repo input to evaluation output.
              </h2>
            </div>
            <a
              className="inline-flex h-10 w-fit items-center justify-center rounded-sm border border-black/15 bg-white px-4 text-sm font-medium transition hover:border-black/30"
              href="#get-started"
            >
              See deployment path
            </a>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-black/10 bg-black/10 md:grid-cols-4">
            {workflow.map((step, index) => (
              <div className="bg-white p-5" key={step}>
                <span className="font-mono text-xs text-neutral-500">
                  0{index + 1}
                </span>
                <p className="mt-5 text-lg font-medium tracking-tight">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="get-started">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-[1fr_auto] md:items-center md:py-20">
          <div>
            <p className="text-sm font-medium text-neutral-500">Deploy</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Keep the UI independent while the backend evolves.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600">
              This first landing page is static by design. It can be deployed as
              a separate Next.js app, then wired to the existing Codesheep APIs
              when product flows are ready.
            </p>
          </div>
          <div className="rounded-md border border-black/10 p-4 font-mono text-sm">
            <p className="text-neutral-500">UI</p>
            <p className="mt-2">npm run dev</p>
            <p className="text-neutral-500">npm run build</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-neutral-500 md:flex-row md:items-center md:justify-between">
          <p>Code Sheep</p>
          <div className="flex gap-5">
            <a className="transition hover:text-black" href="#features">
              Features
            </a>
            <a className="transition hover:text-black" href="#workflow">
              Workflow
            </a>
            <a className="transition hover:text-black" href="#get-started">
              Deploy
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
