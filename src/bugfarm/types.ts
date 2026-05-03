export type BugDifficulty = "easy" | "medium" | "hard";

export type SeedBugRequest = {
  repoPath: string;
  area?: string;
  difficulty?: BugDifficulty;
  language?: string;
  bugCount?: number;
  numberOfBugs?: number;
};

export type SeedBugSuccess = {
  status: "success";
  repoPath: string;
  summary: string;
  difficulty: string;
  bugCount: number;
  filesChanged: string[];
  bugReportPath: string;
};

export type SeedBugError = {
  status: "error";
  message: string;
};

export type SeedBugResponse = SeedBugSuccess | SeedBugError;
