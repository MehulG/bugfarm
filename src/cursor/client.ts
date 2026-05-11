import { Agent } from "@cursor/sdk";
import type { ConversationTurn, SDKMessage } from "@cursor/sdk";
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
    for (const text of assistantTextsFromSdkMessage(event)) {
      output += `${JSON.stringify({ source: "cursor.stream.assistant", output: text })}\n`;
    }
  }

  if (run.supports("wait")) {
    try {
      const result = await run.wait();
      if (result.result?.trim()) {
        output += `${JSON.stringify({ source: "cursor.wait", output: result.result })}\n`;
      }
    } catch {
      // Streaming output above remains the fallback for SDK/runtime variants without wait support.
    }
  }

  if (run.supports("conversation")) {
    try {
      const finalAssistantText = finalAssistantTextFromConversation(await run.conversation());
      if (finalAssistantText) {
        output += `${JSON.stringify({ source: "cursor.conversation", output: finalAssistantText })}\n`;
      }
    } catch {
      // Some SDK run modes do not retain conversation history; the stream/wait output is enough.
    }
  }

  return output;
}

export function assistantTextsFromSdkMessage(message: SDKMessage): string[] {
  if (message.type !== "assistant") {
    return [];
  }
  return message.message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0);
}

export function finalAssistantTextFromConversation(conversation: ConversationTurn[]): string | undefined {
  const assistantTexts: string[] = [];
  for (const turn of conversation) {
    if (turn.type !== "agentConversationTurn") {
      continue;
    }
    for (const step of turn.turn.steps) {
      if (step.type === "assistantMessage" && step.message.text.trim()) {
        assistantTexts.push(step.message.text);
      }
    }
  }
  return assistantTexts.at(-1);
}
