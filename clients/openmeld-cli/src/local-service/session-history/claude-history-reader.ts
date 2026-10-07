import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  getSessionInfo,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { HistoryMessage } from "./codex-history-reader";

// SDK SessionMessage.message is opaque. Only native text blocks cross this boundary.
export function projectClaudeHistory(
  items: readonly SessionMessage[],
  sessionId: string
) {
  const messages: HistoryMessage[] = [];
  let omittedNonMessageItems = false;
  for (const item of items) {
    if (item.session_id !== sessionId) {
      throw new Error("Session identity mismatch.");
    }
    if (
      item.type === "system" ||
      item.parent_tool_use_id ||
      item.parent_agent_id
    ) {
      omittedNonMessageItems = true;
      continue;
    }
    const message = z
      .object({ content: z.union([z.string(), z.array(z.unknown())]) })
      .parse(item.message);
    const parts =
      typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((part) => {
            const text = z
              .object({ type: z.literal("text"), text: z.string() })
              .safeParse(part);
            if (text.success) {
              return [text.data.text];
            }
            omittedNonMessageItems = true;
            return [];
          });
    if (!parts.length) {
      continue;
    }
    const text = parts.join("\n");
    messages.push({
      role: item.type,
      text: text.slice(0, 8000),
      truncated: text.length > 8000,
    });
  }
  return { messages, omittedNonMessageItems };
}

export async function readClaudeHistory(input: {
  sessionId: string;
  authorizePath: (cwd: string) => Promise<void>;
}) {
  const metadata = await getSessionInfo(input.sessionId);
  if (
    !metadata?.cwd ||
    metadata.sessionId !== input.sessionId ||
    metadata.fileSize === undefined ||
    metadata.fileSize > 8 * 1024 * 1024
  ) {
    throw new Error(
      "Claude Code session metadata is unavailable or too large."
    );
  }
  await input.authorizePath(metadata.cwd);
  // These SDK APIs read the retained transcript; query/resume is never invoked.
  const items = await getSessionMessages(input.sessionId, {
    dir: metadata.cwd,
  });
  const current = await getSessionInfo(input.sessionId, { dir: metadata.cwd });
  if (
    !current ||
    current.cwd !== metadata.cwd ||
    current.fileSize !== metadata.fileSize ||
    current.lastModified !== metadata.lastModified
  ) {
    throw new Error("Claude Code session changed during the read.");
  }
  await input.authorizePath(current.cwd);
  return { cwd: current.cwd, ...projectClaudeHistory(items, input.sessionId) };
}
