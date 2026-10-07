import { resolveInstalledCodexLaunchCandidates } from "@openmeld/adapter-codex";
import { z } from "zod/v4";
import { createCodexJsonRpcClient } from "../../agent-activity/codex-read-client";

// Projection of Codex 0.150.1 generated ThreadReadResponse / ThreadItem types.
// Unknown item kinds are deliberately omitted, never stringified.
const threadSchema = z.object({
  id: z.string(),
  cwd: z.string().min(1),
  turns: z.array(z.object({ items: z.array(z.unknown()) })).max(100_000),
});
const userMessage = z.object({
  type: z.literal("userMessage"),
  content: z.array(z.unknown()),
});
const assistantMessage = z.object({
  type: z.literal("agentMessage"),
  text: z.string(),
});
const textContent = z.object({ type: z.literal("text"), text: z.string() });

export type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
  truncated: boolean;
};

export function projectCodexHistory(value: unknown, sessionId: string) {
  const { thread } = z.object({ thread: threadSchema }).parse(value);
  if (thread.id !== sessionId) {
    throw new Error("Session identity mismatch.");
  }
  const messages: HistoryMessage[] = [];
  let omittedNonMessageItems = false;
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const assistant = assistantMessage.safeParse(item);
      const user = userMessage.safeParse(item);
      let text: string;
      let role: HistoryMessage["role"];
      if (assistant.success) {
        text = assistant.data.text;
        role = "assistant";
      } else if (user.success) {
        const parts = user.data.content.flatMap((part) => {
          const parsed = textContent.safeParse(part);
          if (parsed.success) {
            return [parsed.data.text];
          }
          omittedNonMessageItems = true;
          return [];
        });
        text = parts.join("\n");
        role = "user";
      } else {
        omittedNonMessageItems = true;
        continue;
      }
      messages.push({
        role,
        text: text.slice(0, 8000),
        truncated: text.length > 8000,
      });
    }
  }
  return { cwd: thread.cwd, messages, omittedNonMessageItems };
}

export async function readCodexHistory(input: {
  sessionId: string;
  authorizePath: (cwd: string) => Promise<void>;
}) {
  const launch = await resolveInstalledCodexLaunchCandidates({
    timeoutMs: 5000,
  });
  if (!(launch.ok && launch.candidates[0])) {
    throw new Error("Codex is unavailable.");
  }
  const client = createCodexJsonRpcClient(launch.candidates[0].launchContract);
  try {
    await client.request("initialize", {
      clientInfo: { name: "openmeld-session-history", version: "1" },
    });
    client.notify("initialized", {});
    const metadata = z.object({ thread: threadSchema }).parse(
      await client.request("thread/read", {
        threadId: input.sessionId,
        includeTurns: false,
      })
    );
    if (metadata.thread.id !== input.sessionId) {
      throw new Error("Session identity mismatch.");
    }
    await input.authorizePath(metadata.thread.cwd);
    const history = projectCodexHistory(
      await client.request("thread/read", {
        threadId: input.sessionId,
        includeTurns: true,
      }),
      input.sessionId
    );
    await input.authorizePath(history.cwd);
    return history;
  } finally {
    await client.close();
  }
}
