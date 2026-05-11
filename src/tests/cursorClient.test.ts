import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantTextsFromSdkMessage,
  finalAssistantTextFromConversation,
} from "../cursor/client.js";
import type { ConversationTurn, SDKMessage } from "@cursor/sdk";

test("assistantTextsFromSdkMessage extracts assistant text and ignores thinking", () => {
  assert.deepEqual(
    assistantTextsFromSdkMessage({
      type: "thinking",
      agent_id: "agent",
      run_id: "run",
      text: "internal reasoning",
    } satisfies SDKMessage),
    [],
  );

  assert.deepEqual(
    assistantTextsFromSdkMessage({
      type: "assistant",
      agent_id: "agent",
      run_id: "run",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "{\"designs\":[]}" },
          { type: "tool_use", id: "tool", name: "read", input: {} },
        ],
      },
    } satisfies SDKMessage),
    ["{\"designs\":[]}"],
  );
});

test("finalAssistantTextFromConversation returns the last assistant message", () => {
  const conversation = [
    {
      type: "agentConversationTurn",
      turn: {
        userMessage: { text: "request" },
        steps: [
          { type: "assistantMessage", message: { text: "first" } },
          { type: "assistantMessage", message: { text: "final" } },
        ],
      },
    },
  ] satisfies ConversationTurn[];

  assert.equal(finalAssistantTextFromConversation(conversation), "final");
});
