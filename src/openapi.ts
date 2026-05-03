export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "BugFarm POC API",
    version: "0.1.0",
    description:
      "HTTP API for seeding realistic, non-malicious bugs into a local or GitHub repository with Cursor SDK.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: {
                      type: "string",
                      const: "ok",
                    },
                  },
                },
                example: {
                  status: "ok",
                },
              },
            },
          },
        },
      },
    },
    "/seed-bug": {
      post: {
        summary: "Seed a bug into a repository",
        operationId: "seedBug",
        description:
          "Runs the Cursor SDK against a local Git repository or a temporary clone of a GitHub repository, then asks it to introduce the requested number of realistic intentional bugs plus a BUG_REPORT.md file.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SeedBugRequest",
              },
              example: {
                repoPath: "octocat/Hello-World",
                area: "auth",
                difficulty: "medium",
                language: "typescript",
                bugCount: 1,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Bug seeded successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugSuccess",
                },
                example: {
                  status: "success",
                  requestedRepoPath: "octocat/Hello-World",
                  repoPath: "/tmp/bugfarm-abcd12/octocat-Hello-World",
                  repoSource: "github",
                  summary: "Introduced a realistic token expiry edge-case bug",
                  difficulty: "medium",
                  bugCount: 1,
                  filesChanged: ["src/auth/session.ts", "BUG_REPORT.md"],
                  bugReportPath: "/absolute/path/to/repo/BUG_REPORT.md",
                },
              },
            },
          },
          "400": {
            description: "Invalid request",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
                example: {
                  status: "error",
                  message: "Repo path does not exist",
                },
              },
            },
          },
          "500": {
            description: "Bug seeding failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
                example: {
                  status: "error",
                  message: "BUG_REPORT.md was not created",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      SeedBugRequest: {
        type: "object",
        required: ["repoPath"],
        properties: {
          repoPath: {
            type: "string",
            description:
              "Absolute local repo path, GitHub HTTPS URL, GitHub SSH URL, github.com/owner/repo path, or owner/repo shorthand. GitHub repos are cloned into a temporary local working directory.",
            examples: [
              "/absolute/path/to/repo",
              "https://github.com/owner/repo",
              "git@github.com:owner/repo.git",
              "owner/repo",
            ],
          },
          area: {
            type: "string",
            description:
              "Optional prompt hint for the repo area Cursor should prefer, such as auth, billing, routing, or validation.",
            examples: ["auth"],
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "Optional prompt hint for how subtle the seeded bug should be.",
            default: "medium",
          },
          language: {
            type: "string",
            description: "Optional prompt hint for the primary language to target.",
            examples: ["typescript"],
          },
          bugCount: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Optional number of distinct bugs to seed. Defaults to 1.",
            default: 1,
          },
          numberOfBugs: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            deprecated: true,
            description: "Alias for bugCount.",
          },
        },
      },
      SeedBugSuccess: {
        type: "object",
        required: [
          "status",
          "requestedRepoPath",
          "repoPath",
          "repoSource",
          "summary",
          "difficulty",
          "bugCount",
          "filesChanged",
          "bugReportPath",
        ],
        properties: {
          status: {
            type: "string",
            const: "success",
          },
          requestedRepoPath: {
            type: "string",
          },
          repoPath: {
            type: "string",
            description:
              "Local working path that Cursor modified. For GitHub inputs this is the temporary clone path.",
          },
          repoSource: {
            type: "string",
            enum: ["local", "github"],
          },
          summary: {
            type: "string",
          },
          difficulty: {
            type: "string",
          },
          bugCount: {
            type: "integer",
          },
          filesChanged: {
            type: "array",
            items: {
              type: "string",
            },
          },
          bugReportPath: {
            type: "string",
          },
        },
      },
      SeedBugError: {
        type: "object",
        required: ["status", "message"],
        properties: {
          status: {
            type: "string",
            const: "error",
          },
          message: {
            type: "string",
          },
        },
      },
    },
  },
} as const;
