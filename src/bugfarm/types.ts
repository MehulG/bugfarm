export type BugDifficulty = "easy" | "medium" | "hard";

export type SeedBugRequest = {
  repoPath: string;
  area?: string;
  difficulty?: BugDifficulty;
  language?: string;
};

export type SeedBugSuccess = {
  status: "success";
  repoPath: string;
  summary: string;
  difficulty: string;
  filesChanged: string[];
  bugReportPath: string;
};

export type SeedBugError = {
  status: "error";
  message: string;
};

export type SeedBugResponse = SeedBugSuccess | SeedBugError;
