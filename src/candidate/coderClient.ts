import { config } from "../config.js";

export type CoderUser = {
  id: string;
  username: string;
};

export type CoderWorkspace = {
  id: string;
  name: string;
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
