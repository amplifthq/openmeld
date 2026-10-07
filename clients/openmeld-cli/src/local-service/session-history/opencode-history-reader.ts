import { homedir } from "node:os";
import { z } from "zod/v4";
import {
  queryOpenCodeReadOnly,
  resolveOpenCodeDatabasePath,
} from "../../agent-activity/opencode-storage";
import type { HistoryMessage } from "./codex-history-reader";

// OpenCode Session/Message/Part tables and SDK TextPart contract (1.18.34).
// Select only text, never materialize tool output or reasoning into our process.
export async function readOpenCodeHistory(input: {
  sessionId: string;
  authorizePath: (cwd: string) => Promise<void>;
  databasePath?: string;
}) {
  const databasePath =
    input.databasePath ?? resolveOpenCodeDatabasePath({ homeDir: homedir() });
  const metadataSchema = z.object({
    id: z.string(),
    directory: z.string().min(1),
    time_updated: z.number(),
    revert: z.string().nullable(),
  });
  const metadataSql =
    "SELECT id, directory, time_updated, revert FROM session WHERE id = ?";
  const [row] = await queryOpenCodeReadOnly(databasePath, metadataSql, [
    input.sessionId,
  ]);
  const metadata = metadataSchema.parse(row);
  await input.authorizePath(metadata.directory);
  // A reverted conversation has a different visible branch. Do not return undone text.
  const revert = metadata.revert
    ? z.object({ messageID: z.string() }).parse(JSON.parse(metadata.revert))
    : null;
  const rows = await queryOpenCodeReadOnly(
    databasePath,
    `
    SELECT m.id, json_extract(m.data, '$.role') AS role,
      substr(json_extract(p.data, '$.text'), 1, 8001) AS text
    FROM message m JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id
    WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'text'
      AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
      AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0
      AND json_extract(m.data, '$.role') IN ('user', 'assistant')
    ORDER BY m.time_created, m.id, p.id LIMIT 1001`,
    [input.sessionId]
  );
  if (rows.length > 1000 || JSON.stringify(rows).length > 8 * 1024 * 1024) {
    throw new Error("Session is too large.");
  }
  const messages: HistoryMessage[] = [];
  let previousId: string | null = null;
  for (const row of rows) {
    const part = z
      .object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      })
      .parse(row);
    if (revert && part.id >= revert.messageID) {
      break;
    }
    const previous = messages.at(-1);
    if (previous && previousId === part.id) {
      const combined = `${previous.text}\n${part.text}`;
      previous.text = combined.slice(0, 8000);
      previous.truncated ||= combined.length > 8000;
    } else {
      messages.push({
        role: part.role,
        text: part.text.slice(0, 8000),
        truncated: part.text.length > 8000,
      });
    }
    previousId = part.id;
  }
  const [current] = await queryOpenCodeReadOnly(databasePath, metadataSql, [
    input.sessionId,
  ]);
  if (
    JSON.stringify(metadataSchema.parse(current)) !== JSON.stringify(metadata)
  ) {
    throw new Error("Session changed during the read.");
  }
  await input.authorizePath(metadata.directory);
  return { cwd: metadata.directory, messages, omittedNonMessageItems: true };
}
