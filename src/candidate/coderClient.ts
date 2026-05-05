import { config } from "../config.js";

export type CoderUser = {
  id: string;
  username: string;
};

export type CoderWorkspace = {
  id: string;
  name: string;
};

export type CoderWorkspaceReadiness = {
  status: "starting" | "ready" | "failed";
  message?: string;
};

export type CoderClientConfig = {
  publicUrl: string;
  apiUrl: string;
  apiToken: string;
  organizationId: string;
  templateId: string;
  workspaceTtlMs: number;
};

export class CoderClient {
  constructor(private readonly clientConfig: CoderClientConfig = requireCoderConfig()) {}

  async createUser(input: {
    username: string;
    password: string;
    email: string;
    name: string;
  }): Promise<CoderUser> {
    const body = await this.request<{ id: string; username: string }>("/api/v2/users", {
      method: "POST",
      body: {
        username: input.username,
        email: input.email,
        name: input.name,
        password: input.password,
        login_type: "password",
        organization_ids: [this.clientConfig.organizationId],
        roles: [],
        service_account: false,
        user_status: "active",
      },
    });

    return {
      id: body.id,
      username: body.username || input.username,
    };
  }

  async createWorkspace(input: {
    username: string;
    workspaceName: string;
    artifactHash: string;
    sessionId: string;
    artifactToken: string;
    aiProxyToken: string;
  }): Promise<CoderWorkspace> {
    const body = await this.request<{ id: string; name: string }>(
      `/api/v2/users/${encodeURIComponent(input.username)}/workspaces`,
      {
        method: "POST",
        body: {
          name: input.workspaceName,
          template_id: this.clientConfig.templateId,
          ttl_ms: this.clientConfig.workspaceTtlMs,
          automatic_updates: "never",
          rich_parameter_values: [
            {
              name: "artifact_hash",
              value: input.artifactHash,
            },
            {
              name: "session_id",
              value: input.sessionId,
            },
            {
              name: "artifact_token",
              value: input.artifactToken,
            },
            {
              name: "ai_proxy_token",
              value: input.aiProxyToken,
            },
          ],
        },
      },
    );

    return {
      id: body.id,
      name: body.name || input.workspaceName,
    };
  }

  async updateUserPassword(input: {
    username: string;
    password: string;
  }): Promise<void> {
    await this.request(`/api/v2/users/${encodeURIComponent(input.username)}/password`, {
      method: "PUT",
      body: {
        password: input.password,
      },
      expectJson: false,
    });
  }

  workspaceUrl(username: string, workspaceName: string): string {
    return `${this.clientConfig.publicUrl.replace(/\/+$/, "")}/@${encodeURIComponent(username)}/${encodeURIComponent(workspaceName)}`;
  }

  codeServerUrl(username: string, workspaceName: string): string {
    return `${this.workspaceUrl(username, `${workspaceName}.main`)}/apps/code-server/`;
  }

  async getWorkspaceReadiness(workspaceId: string): Promise<CoderWorkspaceReadiness> {
    const workspace = await this.request<CoderWorkspaceResponse>(
      `/api/v2/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: "GET",
      },
    );
    const buildStatus = workspace.latest_build?.status || workspace.status;

    if (buildStatus && ["failed", "canceled", "canceling", "deleted", "deleting", "timeout"].includes(buildStatus)) {
      const message = workspace.latest_build?.job?.error || `Coder workspace status is ${buildStatus}`;
      return {
        status: "failed",
        message,
      };
    }

    const app = findCodeServerApp(workspace);
    if (app?.health === "healthy") {
      return {
        status: "ready",
      };
    }

    return {
      status: "starting",
      message: app?.health ? `code-server is ${app.health}` : `Coder workspace status is ${buildStatus || "starting"}`,
    };
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      expectJson?: boolean;
    },
  ): Promise<T> {
    const url = `${this.clientConfig.apiUrl.replace(/\/+$/, "")}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Coder-Session-Token": this.clientConfig.apiToken,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      const cause = error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Coder API ${options.method} ${url} failed before response: ${cause}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coder API ${options.method} ${url} failed with ${response.status}: ${text}`);
    }

    if (options.expectJson === false || response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

type CoderWorkspaceResponse = {
  status?: string;
  latest_build?: {
    status?: string;
    job?: {
      error?: string;
    };
    resources?: Array<{
      agents?: Array<{
        apps?: Array<{
          slug?: string;
          display_name?: string;
          health?: string;
        }>;
      }>;
    }>;
  };
};

function findCodeServerApp(workspace: CoderWorkspaceResponse): { health?: string } | undefined {
  for (const resource of workspace.latest_build?.resources ?? []) {
    for (const agent of resource.agents ?? []) {
      for (const app of agent.apps ?? []) {
        if (app.slug === "code-server" || app.display_name === "code-server") {
          return app;
        }
      }
    }
  }

  return undefined;
}

export function requireCoderConfig(): CoderClientConfig {
  const missing = [
    ["CODER_URL", config.coderUrl],
    ["CODER_API_URL", config.coderApiUrl],
    ["CODER_API_TOKEN", config.coderApiToken],
    ["CODER_ORGANIZATION_ID", config.coderOrganizationId],
    ["CODER_TEMPLATE_ID", config.coderTemplateId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing Coder configuration: ${missing.join(", ")}`);
  }

  return {
    publicUrl: config.coderUrl!,
    apiUrl: config.coderApiUrl!,
    apiToken: config.coderApiToken!,
    organizationId: config.coderOrganizationId!,
    templateId: config.coderTemplateId!,
    workspaceTtlMs: config.coderWorkspaceTtlMs,
  };
}
