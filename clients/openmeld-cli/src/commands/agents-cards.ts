import pc from "picocolors";
import type { createPresenter } from "../runtime/presenter/index";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { formatAgentMention, formatAgentsToneText } from "./agents-text";

const AGENTS_CARD_MIN_CONTENT_WIDTH = 34;

export function renderAgentsInfoCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  title: string;
  codePrefix: string;
  rows: InfoCardRow[];
  minContentWidth?: number;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: input.title,
    codePrefix: input.codePrefix,
    rows: input.rows,
    minContentWidth: input.minContentWidth ?? AGENTS_CARD_MIN_CONTENT_WIDTH,
    horizontalPadding: 1,
    compact: true,
  });
}

export function formatAgentListItem(input: {
  agentId: string;
  displayName: string;
  detail?: string;
}): string {
  const parts = [
    formatAgentMention(input.agentId),
    pc.dim("·"),
    input.displayName,
  ];
  if (input.detail) {
    parts.push(pc.dim(input.detail));
  }
  return parts.join(" ");
}

export function buildReadyAgentCardRow(
  agentId: string,
  displayName: string
): InfoCardRow {
  return {
    label: "",
    value: formatAgentListItem({
      agentId,
      displayName,
    }),
  };
}

export function buildStatusAgentCardRow(input: {
  agentId: string;
  displayName: string;
  detail: string;
}): InfoCardRow {
  return {
    label: "",
    value: formatAgentListItem({
      agentId: input.agentId,
      displayName: input.displayName,
      detail: input.detail,
    }),
  };
}

export function buildTurnedOffAgentCardRow(
  agentId: string,
  displayName: string
): InfoCardRow {
  return {
    label: "",
    value: formatAgentListItem({
      agentId,
      displayName,
    }),
  };
}

export function buildReadyCountValue(count: number, noun: string): string {
  return `${formatAgentsToneText("success", pc.bold(String(count)))} ${pc.dim(noun)}`;
}

export function buildNotReadyCountValue(count: number, noun: string): string {
  return `${formatAgentsToneText("warning", pc.bold(String(count)))} ${pc.dim(noun)}`;
}
