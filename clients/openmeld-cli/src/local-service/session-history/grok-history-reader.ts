import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import type { HistoryMessage } from "./codex-history-reader";

async function readBoundedFile(path: string) {
  // biome-ignore lint/suspicious/noBitwiseOperators: fs.open flags are a bit mask.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 8 * 1024 * 1024) {
      throw new Error("Session file is too large.");
    }
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        null
      );
      if (!bytesRead) {
        break;
      }
      length += bytesRead;
    }
    const after = await file.stat();
    if (
      length !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.size !== before.size
    ) {
      throw new Error("Session changed during the read.");
    }
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await file.close();
  }
}

// xai-org/grok-build storage::SessionUpdateEnvelope contains ACP notifications.
// Do not consume chat_history.jsonl: that is the model context, including tools.
export function projectGrokHistory(source: string, sessionId: string) {
  const messages: HistoryMessage[] = [];
  let omittedNonMessageItems = false;
  let previousRole: HistoryMessage["role"] | null = null;
  for (const line of source.split("\n").filter(Boolean)) {
    const envelope = z
      .object({
        method: z.string(),
        params: z.object({
          sessionId: z.string(),
          update: z.object({ sessionUpdate: z.string() }).passthrough(),
        }),
      })
      .parse(JSON.parse(line));
    if (envelope.params.sessionId !== sessionId) {
      throw new Error("Session identity mismatch.");
    }
    const update = envelope.params.update;
    // Undo has semantic effects across earlier updates. Fail closed until supported.
    if (update.sessionUpdate === "rewind_marker") {
      throw new Error("Rewound sessions are not supported.");
    }
    if (
      envelope.method !== "session/update" ||
      !["user_message_chunk", "agent_message_chunk"].includes(
        update.sessionUpdate
      )
    ) {
      omittedNonMessageItems = true;
      previousRole = null;
      continue;
    }
    const chunk = z
      .object({
        content: z.object({
          type: z.string(),
          text: z.string().optional(),
          _meta: z.object({ bash_command: z.unknown().optional() }).optional(),
        }),
        _meta: z.object({ host_turn: z.boolean().optional() }).optional(),
      })
      .parse(update);
    if (
      chunk.content.type !== "text" ||
      chunk.content.text === undefined ||
      chunk._meta?.host_turn ||
      chunk.content._meta?.bash_command !== undefined
    ) {
      omittedNonMessageItems = true;
      previousRole = null;
      continue;
    }
    const role =
      update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
    const previous = messages.at(-1);
    if (previous && previousRole === role) {
      const text = previous.text + chunk.content.text;
      previous.text = text.slice(0, 8000);
      previous.truncated ||= text.length > 8000;
    } else {
      messages.push({
        role,
        text: chunk.content.text.slice(0, 8000),
        truncated: chunk.content.text.length > 8000,
      });
    }
    previousRole = role;
  }
  return { messages, omittedNonMessageItems };
}

export async function readGrokHistory(input: {
  sessionId: string;
  authorizePath: (cwd: string) => Promise<void>;
  grokHome?: string;
}) {
  // Session IDs are directory names, never caller-controlled paths.
  const sessionId = z.uuid().parse(input.sessionId);
  const root = join(
    input.grokHome ?? process.env.GROK_HOME ?? join(homedir(), ".grok"),
    "sessions"
  );
  const matches: string[] = [];
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) {
      continue;
    }
    for (const session of await readdir(join(root, project.name), {
      withFileTypes: true,
    })) {
      if (session.isDirectory() && session.name === sessionId) {
        matches.push(join(root, project.name, session.name));
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error("Session identity is missing or ambiguous.");
  }
  const directory = z.string().parse(matches[0]);
  const source = await readBoundedFile(join(directory, "summary.json"));
  const identity = z.object({ id: z.string(), cwd: z.string().min(1) });
  const value: unknown = JSON.parse(source);
  const summary = identity
    .or(z.object({ info: identity }).transform(({ info }) => info))
    .parse(value);
  if (summary.id !== sessionId) {
    throw new Error("Session identity mismatch.");
  }
  await input.authorizePath(summary.cwd);
  const history = projectGrokHistory(
    await readBoundedFile(join(directory, "updates.jsonl")),
    sessionId
  );
  if ((await readBoundedFile(join(directory, "summary.json"))) !== source) {
    throw new Error("Session changed during the read.");
  }
  await input.authorizePath(summary.cwd);
  return { cwd: summary.cwd, ...history };
}
