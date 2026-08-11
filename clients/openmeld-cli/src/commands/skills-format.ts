import pc from "picocolors";
import {
  formatOpenMeldCliCommand,
  formatOpenMeldCliTextBlock,
} from "../runtime/cli-entry-command";
import { type InfoCardRow, renderTextInfoCard } from "../ui/info-card";
import { outLine } from "../ui/io";

export const formatSkillsCopy = (text: string): string =>
  formatOpenMeldCliTextBlock(text);
const SKILLS_CARD_MIN_CONTENT_WIDTH = 56;
export function renderSkillsTextCard(input: {
  title: string;
  rows: InfoCardRow[];
  compact?: boolean;
  minContentWidth?: number;
}): void {
  renderTextInfoCard({
    title: input.title,
    rows: input.rows,
    emitLine: outLine,
    compact: input.compact,
    minContentWidth: input.minContentWidth ?? SKILLS_CARD_MIN_CONTENT_WIDTH,
    horizontalPadding: 1,
  });
}

export function formatSkillsStoreValue(storeDir: string): string {
  return pc.bold(pc.cyan(storeDir));
}

export function formatSkillsCount(
  count: number,
  tone: "green" | "yellow" | "red" | "neutral"
): string {
  if (count === 0) {
    return pc.dim("0");
  }
  const value = pc.bold(String(count));
  if (tone === "green") {
    return pc.green(value);
  }
  if (tone === "yellow") {
    return pc.yellow(value);
  }
  if (tone === "red") {
    return pc.red(value);
  }
  return value;
}

export function formatInlineCommandList(commands: string[]): string {
  return commands.map((command) => `\`${command}\``).join(", ");
}

export function formatSkillsCommand(command: string): string {
  return pc.bold(pc.cyan(formatOpenMeldCliCommand(command)));
}
