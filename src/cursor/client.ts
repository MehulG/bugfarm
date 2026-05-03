import { Agent } from "@cursor/sdk";
import { config } from "../config.js";

export async function runCursorAgent(input: {
  repoPath: string;
  prompt: string;
  model?: string;
}): Promise<string> {
  if (!config.cursorApiKey) {
    throw new Error("CURSOR_API_KEY is required");
  }

  const agent = await Agent.create({
    apiKey: config.cursorApiKey,
    model: {
      id: input.model || config.modelName,
    },
    local: {
      cwd: input.repoPath,
    },
  });

  const run = await agent.send(input.prompt);

  let output = "";

  for await (const event of run.stream()) {
    output += `${JSON.stringify(event)}\n`;
  }

  return output;
}
