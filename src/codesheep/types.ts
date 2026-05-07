export type BugDifficulty = "easy" | "medium" | "hard";

export type SeedBugRequest = {
  repoPath: string;
  area?: string;
  difficulty?: BugDifficulty;
  language?: string;
  bugCount?: number;
  numberOfBugs?: number;
  bugDiversification?: boolean;
};

export type SeedBugSuccess = {
  status: "success";
  requestedRepoPath: string;
  repoPath: string;
  repoSource: "local" | "github";
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
