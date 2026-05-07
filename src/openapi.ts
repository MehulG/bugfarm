import { config } from "./config.js";

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Codesheep POC API",
    version: "0.1.0",
    description:
      "HTTP API for seeding realistic, non-malicious bugs into a local or GitHub repository with Cursor SDK.",
  },
  servers: [
    {
      url: config.publicBackendUrl,
      description: "Configured backend URL",
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
    "/v1/models": {
      get: {
        summary: "List candidate AI proxy models",
        operationId: "listAiProxyModels",
        description:
          "Returns the public model alias exposed to candidate workspaces. Requires a session-scoped AI proxy bearer token.",
        security: [{ aiProxyBearer: [] }],
        responses: {
          "200": {
            description: "Model list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["object", "data"],
                  properties: {
                    object: { type: "string", const: "list" },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "object"],
                        properties: {
                          id: { type: "string" },
                          object: { type: "string", const: "model" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Missing AI proxy token" },
          "403": { description: "Invalid, inactive, expired, or disabled AI proxy token" },
        },
      },
    },
    "/v1/chat/completions": {
      post: {
        summary: "Proxy candidate AI chat completions",
        operationId: "proxyAiChatCompletions",
        description:
          "OpenAI-compatible chat completions proxy for candidate workspaces. The backend validates the scoped token, enforces quota, overrides the requested model, forwards to the configured upstream, and records an audit transcript.",
        security: [{ aiProxyBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                required: ["messages"],
                properties: {
                  model: { type: "string" },
                  messages: { type: "array", items: { type: "object", additionalProperties: true } },
                  stream: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Upstream chat completion response",
          },
          "401": { description: "Missing AI proxy token" },
          "403": { description: "Invalid, inactive, expired, or disabled AI proxy token" },
          "429": { description: "AI proxy quota exceeded" },
          "502": { description: "Upstream AI provider request failed" },
          "503": { description: "AI upstream provider is not configured" },
        },
      },
    },
    "/api/candidate/submit": {
      post: {
        summary: "Submit a candidate workspace for evaluation",
        operationId: "submitCandidateWorkspace",
        description:
          "Accepts a session-scoped submit token from inside the candidate workspace, queues a one-time evaluation run, and returns submission status without exposing the score.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["notes"],
                properties: {
                  notes: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Submission accepted or already exists" },
          "400": { description: "Missing submission notes" },
          "401": { description: "Missing submission token" },
          "403": { description: "Invalid or expired submission token" },
        },
      },
    },
    "/api/submissions": {
      get: {
        summary: "List full candidate submissions",
        operationId: "listCandidateSubmissions",
        description:
          "Returns complete stored submission/evaluation records. Filter by assessmentId to fetch submissions for a particular assignment, or by sessionId to fetch the submission for one candidate session.",
        parameters: [
          {
            in: "query",
            name: "assessmentId",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "sessionId",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 50,
            },
          },
        ],
        responses: {
          "200": {
            description: "Complete submission records",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["submissions"],
                  properties: {
                    submissions: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/submissions/assessment/{assessmentId}": {
      get: {
        summary: "Fetch full submissions for an assessment",
        operationId: "getAssessmentSubmissions",
        description:
          "Returns complete stored submission/evaluation records for all candidate submissions belonging to one assessment.",
        parameters: [
          {
            in: "path",
            name: "assessmentId",
            required: true,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 50,
            },
          },
        ],
        responses: {
          "200": {
            description: "Complete assessment submission records",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["assessmentId", "submissions"],
                  properties: {
                    assessmentId: { type: "string" },
                    submissions: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/submission/assessment/{assessmentId}": {
      get: {
        summary: "Fetch full submissions for an assessment",
        operationId: "getAssessmentSubmissionAlias",
        description:
          "Singular alias for fetching complete stored submission/evaluation records for all candidate submissions belonging to one assessment.",
        parameters: [
          {
            in: "path",
            name: "assessmentId",
            required: true,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 50,
            },
          },
        ],
        responses: {
          "200": {
            description: "Complete assessment submission records",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["assessmentId", "submissions"],
                  properties: {
                    assessmentId: { type: "string" },
                    submissions: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/submissions/{submissionId}": {
      get: {
        summary: "Fetch one full candidate submission",
        operationId: "getCandidateSubmission",
        parameters: [
          {
            in: "path",
            name: "submissionId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Complete submission record" },
          "404": { description: "Submission not found" },
        },
      },
    },
    "/api/submission/{submissionId}": {
      get: {
        summary: "Fetch one full candidate submission",
        operationId: "getCandidateSubmissionAlias",
        description: "Singular alias for fetching one complete candidate submission/evaluation record.",
        parameters: [
          {
            in: "path",
            name: "submissionId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Complete submission record" },
          "404": { description: "Submission not found" },
        },
      },
    },
    "/api/evaluations/assessment/{assessmentId}": {
      get: {
        summary: "Fetch full evaluation results for an assessment",
        operationId: "getAssessmentEvaluationResults",
        description:
          "Returns complete stored submission/evaluation records for all candidate submissions belonging to one assessment.",
        parameters: [
          {
            in: "path",
            name: "assessmentId",
            required: true,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 50,
            },
          },
        ],
        responses: {
          "200": {
            description: "Complete assessment evaluation results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["assessmentId", "submissions"],
                  properties: {
                    assessmentId: { type: "string" },
                    submissions: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/evaluations/{sessionId}": {
      get: {
        summary: "Fetch stored evaluation result for a session",
        operationId: "getCandidateEvaluation",
        parameters: [
          {
            in: "path",
            name: "sessionId",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": { description: "Evaluation result found" },
          "404": { description: "Evaluation not found" },
        },
      },
    },
    "/seed-bug": {
      post: {
        summary: "Seed a bug into a repository",
        operationId: "seedBug",
        description:
          "Queues a bug-seeding job against a local Git repository or a temporary clone of a GitHub repository. Poll the returned job URL for final results.",
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
                bugDiversification: true,
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Bug-seeding job accepted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobAcceptedResponse",
                },
                example: {
                  status: "accepted",
                  jobId: "4d4bb74abdbfb9f8",
                  operation: "seed-bug",
                  pollUrl: "/jobs/4d4bb74abdbfb9f8",
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
    "/generate-assessment": {
      post: {
        summary: "Generate a debugging assessment artifact",
        operationId: "generateAssessment",
        description:
          "Queues full assessment generation. This combines generate-bug and generate-tests into one flow. Poll the returned job URL for the final validated artifact result.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/GenerateAssessmentRequest",
              },
              example: {
                repoPath: "owner/repo",
                area: "auth",
                difficulty: "medium",
                language: "typescript",
                bugCount: 1,
                bugDiversification: true,
                role: "backend engineer",
                assessmentName: "Backend Debugging Screen",
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Assessment-generation job accepted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobAcceptedResponse",
                },
                example: {
                  status: "accepted",
                  jobId: "7b8b1ea7c2e0aa34",
                  operation: "generate-assessment",
                  pollUrl: "/jobs/7b8b1ea7c2e0aa34",
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
              },
            },
          },
          "500": {
            description: "Assessment generation failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/generate-bug": {
      post: {
        summary: "Generate an assessment-style bug artifact",
        operationId: "generateBug",
        description:
          "Queues bug generation for an assessment artifact. This creates baseline-repo, candidate-repo, BUG_REPORT.md, TASK.md, patch, rubric, and metadata, but does not yet generate hidden tests.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/GenerateBugRequest",
              },
              example: {
                repoPath: "owner/repo",
                area: "auth",
                difficulty: "medium",
                language: "typescript",
                bugCount: 1,
                bugDiversification: true,
                role: "backend engineer",
                assessmentName: "Backend Debugging Screen",
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Generate-bug job accepted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobAcceptedResponse",
                },
                example: {
                  status: "accepted",
                  jobId: "8194e4ad7e7f3f52",
                  operation: "generate-bug",
                  pollUrl: "/jobs/8194e4ad7e7f3f52",
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
              },
            },
          },
          "500": {
            description: "Bug artifact generation failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/generate-tests": {
      post: {
        summary: "Generate hidden tests for an assessment artifact",
        operationId: "generateTests",
        description:
          "Queues deterministic hidden-test generation and validation for an existing assessment artifact created by generate-bug.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/GenerateTestsRequest",
              },
              example: {
                artifactPath: "/absolute/path/to/artifacts/backend-debugging-screen-20260504103000-a1b2c3d4",
                language: "python",
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Generate-tests job accepted",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobAcceptedResponse",
                },
                example: {
                  status: "accepted",
                  jobId: "db1f909ddfd4a365",
                  operation: "generate-tests",
                  pollUrl: "/jobs/db1f909ddfd4a365",
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
              },
            },
          },
          "500": {
            description: "Hidden test generation failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/jobs/{jobId}": {
      get: {
        summary: "Poll job status",
        operationId: "getJob",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Current job state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobState",
                },
              },
            },
          },
          "404": {
            description: "Job not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/seed-bug/jobs/{jobId}": {
      get: {
        summary: "Poll seed-bug job status",
        operationId: "getSeedBugJob",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Current seed-bug job state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobState",
                },
              },
            },
          },
          "404": {
            description: "Job not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/generate-assessment/jobs/{jobId}": {
      get: {
        summary: "Poll assessment job status",
        operationId: "getGenerateAssessmentJob",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Current assessment job state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobState",
                },
              },
            },
          },
          "404": {
            description: "Job not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/generate-bug/jobs/{jobId}": {
      get: {
        summary: "Poll generate-bug job status",
        operationId: "getGenerateBugJob",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Current generate-bug job state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobState",
                },
              },
            },
          },
          "404": {
            description: "Job not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
    "/generate-tests/jobs/{jobId}": {
      get: {
        summary: "Poll generate-tests job status",
        operationId: "getGenerateTestsJob",
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Current generate-tests job state",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/JobState",
                },
              },
            },
          },
          "404": {
            description: "Job not found",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SeedBugError",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      aiProxyBearer: {
        type: "http",
        scheme: "bearer",
        description: "Session-scoped AI proxy token generated per candidate workspace.",
      },
    },
    schemas: {
      JobAcceptedResponse: {
        type: "object",
        required: ["status", "jobId", "operation", "pollUrl"],
        properties: {
          status: {
            type: "string",
            const: "accepted",
          },
          jobId: {
            type: "string",
          },
          operation: {
            type: "string",
            enum: ["seed-bug", "generate-bug", "generate-tests", "generate-assessment"],
          },
          pollUrl: {
            type: "string",
          },
        },
      },
      JobState: {
        type: "object",
        required: ["jobId", "operation", "status", "createdAt", "pollUrl"],
        properties: {
          jobId: {
            type: "string",
          },
          operation: {
            type: "string",
            enum: ["seed-bug", "generate-bug", "generate-tests", "generate-assessment"],
          },
          status: {
            type: "string",
            enum: ["queued", "running", "succeeded", "failed"],
          },
          createdAt: {
            type: "string",
            format: "date-time",
          },
          startedAt: {
            type: "string",
            format: "date-time",
          },
          completedAt: {
            type: "string",
            format: "date-time",
          },
          pollUrl: {
            type: "string",
          },
          result: {
            oneOf: [
              {
                $ref: "#/components/schemas/SeedBugSuccess",
              },
              {
                $ref: "#/components/schemas/GenerateAssessmentSuccess",
              },
              {
                $ref: "#/components/schemas/GenerateBugSuccess",
              },
              {
                $ref: "#/components/schemas/GenerateTestsSuccess",
              },
            ],
          },
          error: {
            type: "object",
            required: ["message"],
            properties: {
              message: {
                type: "string",
              },
            },
          },
        },
      },
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
          bugDiversification: {
            type: "boolean",
            description:
              "Optional prompt hint for whether multiple seeded bugs should be diversified across categories, modules, or failure modes. Defaults to true.",
            default: true,
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
      GenerateAssessmentRequest: {
        allOf: [
          {
            $ref: "#/components/schemas/SeedBugRequest",
          },
          {
            type: "object",
            properties: {
              role: {
                type: "string",
                description: "Optional role focus for candidate instructions and rubric metadata.",
                examples: ["backend engineer"],
              },
              assessmentName: {
                type: "string",
                description: "Optional display name used for artifact ID and TASK.md title.",
                examples: ["Backend Debugging Screen"],
              },
            },
          },
        ],
      },
      GenerateBugRequest: {
        $ref: "#/components/schemas/GenerateAssessmentRequest",
      },
      GenerateTestsRequest: {
        type: "object",
        required: ["artifactPath"],
        properties: {
          artifactPath: {
            type: "string",
            description: "Absolute path to an existing artifact directory created by generate-bug.",
          },
          language: {
            type: "string",
            description: "Optional hint for the hidden-test generator.",
            examples: ["python"],
          },
        },
      },
      GenerateBugSuccess: {
        type: "object",
        required: [
          "status",
          "assessmentId",
          "assessmentName",
          "requestedRepoPath",
          "repoSource",
          "artifactPath",
          "candidateRepoPath",
          "baselineRepoPath",
          "hiddenTestsPath",
          "filesChanged",
          "summary",
          "difficulty",
          "bugCount",
          "bugReportPath",
          "taskPath",
          "patchPath",
          "rubricPath"
        ],
        properties: {
          status: { type: "string", const: "success" },
          assessmentId: { type: "string" },
          assessmentName: { type: "string" },
          requestedRepoPath: { type: "string" },
          repoSource: { type: "string", enum: ["local", "github"] },
          artifactPath: { type: "string" },
          candidateRepoPath: { type: "string" },
          baselineRepoPath: { type: "string" },
          hiddenTestsPath: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
          difficulty: { type: "string" },
          bugCount: { type: "integer" },
          bugReportPath: { type: "string" },
          taskPath: { type: "string" },
          patchPath: { type: "string" },
          rubricPath: { type: "string" },
        },
      },
      GenerateTestsSuccess: {
        type: "object",
        required: [
          "status",
          "assessmentId",
          "assessmentName",
          "candidateLaunchUrl",
          "artifactPath",
          "candidateRepoPath",
          "baselineRepoPath",
          "hiddenTestsPath",
          "validation",
          "filesChanged",
          "bugReportPath",
          "taskPath",
          "patchPath",
          "rubricPath"
        ],
        properties: {
          status: { type: "string", const: "success" },
          assessmentId: { type: "string" },
          assessmentName: { type: "string" },
          artifactPath: { type: "string" },
          candidateRepoPath: { type: "string" },
          baselineRepoPath: { type: "string" },
          hiddenTestsPath: { type: "string" },
          validation: { $ref: "#/components/schemas/AssessmentValidation" },
          filesChanged: { type: "array", items: { type: "string" } },
          bugReportPath: { type: "string" },
          taskPath: { type: "string" },
          patchPath: { type: "string" },
          rubricPath: { type: "string" },
        },
      },
      GenerateAssessmentSuccess: {
        type: "object",
        required: [
          "status",
          "assessmentId",
          "assessmentName",
          "artifactPath",
          "candidateRepoPath",
          "baselineRepoPath",
          "hiddenTestsPath",
          "validation",
          "filesChanged",
          "summary",
          "difficulty",
          "bugCount",
          "bugReportPath",
          "taskPath",
          "patchPath",
          "rubricPath",
        ],
        properties: {
          status: {
            type: "string",
            const: "success",
          },
          assessmentId: {
            type: "string",
          },
          assessmentName: {
            type: "string",
          },
          candidateLaunchUrl: {
            type: "string",
            format: "uri",
          },
          artifactPath: {
            type: "string",
          },
          candidateRepoPath: {
            type: "string",
          },
          baselineRepoPath: {
            type: "string",
          },
          hiddenTestsPath: {
            type: "string",
          },
          validation: {
            $ref: "#/components/schemas/AssessmentValidation",
          },
          filesChanged: {
            type: "array",
            items: {
              type: "string",
            },
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
          bugReportPath: {
            type: "string",
          },
          taskPath: {
            type: "string",
          },
          patchPath: {
            type: "string",
          },
          rubricPath: {
            type: "string",
          },
        },
      },
      AssessmentValidation: {
        type: "object",
        required: ["status", "ecosystem", "hiddenTestsPath", "baseline", "candidate", "notes"],
        properties: {
          status: {
            type: "string",
            enum: ["passed", "failed", "skipped"],
            description:
              "Passed means baseline wrapper cases matched the oracle and candidate diverged on bug-exposing cases while matching control cases.",
          },
          ecosystem: {
            type: "string",
            enum: ["node", "python", "unknown"],
          },
          hiddenTestsPath: {
            type: "string",
          },
          retryCount: {
            type: "integer",
          },
          wrapperEntrypoints: {
            type: "array",
            items: {
              type: "string",
            },
          },
          targetSymbols: {
            type: "array",
            items: {
              type: "string",
            },
          },
          baseline: {
            $ref: "#/components/schemas/AssessmentValidationRun",
          },
          candidate: {
            $ref: "#/components/schemas/AssessmentValidationRun",
          },
          notes: {
            type: "array",
            items: {
              type: "string",
            },
          },
          rejectedReason: {
            type: "string",
          },
        },
      },
      AssessmentValidationRun: {
        type: "object",
        required: ["target", "status"],
        properties: {
          target: {
            type: "string",
            enum: ["baseline", "candidate"],
          },
          status: {
            type: "string",
            enum: ["passed", "failed", "skipped"],
          },
          command: {
            type: "string",
          },
          exitCode: {
            type: "integer",
          },
          output: {
            type: "string",
          },
          reason: {
            type: "string",
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
