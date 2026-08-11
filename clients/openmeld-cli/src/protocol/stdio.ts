import { isSpaceQuitCommand } from "../space/quit-command";
import { sanitizeText } from "./wire";

export type StdioLineResult =
  | { kind: "quit" }
  | { kind: "text"; text: string }
  | { kind: "reject"; reason: string };

export function parseStdioLine(line: string): StdioLineResult {
  const raw = String(line ?? "").trim();
  if (isSpaceQuitCommand(raw)) {
    return { kind: "quit" };
  }

  const text = sanitizeText(raw);
  if (!text.ok) {
    return { kind: "reject", reason: text.reason };
  }

  return { kind: "text", text: text.value };
}
