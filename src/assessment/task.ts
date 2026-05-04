import { writeFile } from "node:fs/promises";
import type { GenerateAssessmentRequest } from "./types.js";

export async function writeCandidateTask(input: {
  taskPath: string;
  assessmentName: string;
  request: GenerateAssessmentRequest;
  filesChanged: string[];
}): Promise<void> {
  const roleLine = input.request.role ? `\nRole focus: ${input.request.role}\n` : "";
  const areaLine = input.request.area ? `\nSuggested area to investigate: ${input.request.area}\n` : "";

  const content = `# ${input.assessmentName}

You have been given a repository with one or more realistic regressions.

Your task is to debug the repository, identify the faulty behavior, and make the smallest production-quality fix that restores the expected behavior.
${roleLine}${areaLine}
Constraints:
- Do not read or modify files outside this repository.
- Do not remove tests to make the project pass.
- Keep changes focused on the root cause.
- Add or update tests if that is the normal standard for this repository.
- You may use AI coding assistants, but you are responsible for validating their output.

Requested difficulty: ${input.request.difficulty || "medium"}
Expected number of seeded bugs: ${input.request.bugCount ?? input.request.numberOfBugs ?? 1}

Deliverable:
- A code change that fixes the regression.
- A short explanation of the root cause and how you validated the fix.
`;

  await writeFile(input.taskPath, content, "utf8");
}
