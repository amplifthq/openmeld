import type { Presenter } from "../runtime/presenter";
import { buildUnifiedCardFrame } from "./card-frame";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

export type InfoCardRow = {
  label: string;
  value: string;
};

export function renderInfoCard(input: {
  presenter: Presenter;
  title: string;
  codePrefix: string;
  rows: InfoCardRow[];
  sanitize?: boolean;
  minContentWidth?: number;
  horizontalPadding?: number;
  compact?: boolean;
}): void {
  const frame = buildInfoCardFrame(input);

  input.presenter.line({ code: `${input.codePrefix}.top`, text: frame.top });
  if (!input.compact) {
    input.presenter.line({
      code: `${input.codePrefix}.empty.start`,
      text: frame.empty,
    });
  }

  for (const rowText of frame.rows) {
    input.presenter.line({ code: `${input.codePrefix}.row`, text: rowText });
  }

  if (!input.compact) {
    input.presenter.line({
      code: `${input.codePrefix}.empty.end`,
      text: frame.empty,
    });
  }
  input.presenter.line({
    code: `${input.codePrefix}.bottom`,
    text: frame.bottom,
  });
}

export function renderTextInfoCard(input: {
  title: string;
  rows: InfoCardRow[];
  emitLine: (line: string) => void;
  sanitize?: boolean;
  minContentWidth?: number;
  horizontalPadding?: number;
  compact?: boolean;
}): void {
  for (const line of buildTextInfoCardLines(input)) {
    input.emitLine(line);
  }
}

export function buildTextInfoCardLines(input: {
  title: string;
  rows: InfoCardRow[];
  sanitize?: boolean;
  minContentWidth?: number;
  horizontalPadding?: number;
  compact?: boolean;
}): string[] {
  const frame = buildInfoCardFrame(input);
  const lines = [frame.top];
  if (!input.compact) {
    lines.push(frame.empty);
  }
  lines.push(...frame.rows);
  if (!input.compact) {
    lines.push(frame.empty);
  }
  lines.push(frame.bottom);
  return lines;
}

function buildInfoCardFrame(input: {
  title: string;
  rows: InfoCardRow[];
  sanitize?: boolean;
  minContentWidth?: number;
  horizontalPadding?: number;
}) {
  const rowTextList = input.rows.map((row) =>
    toCardRowText(row, Boolean(input.sanitize))
  );
  return buildUnifiedCardFrame({
    title: input.sanitize ? sanitizeCardTitle(input.title) : input.title,
    rowTextList,
    minContentWidth: input.minContentWidth ?? 48,
    horizontalPadding: input.horizontalPadding,
  });
}

function toCardRowText(row: InfoCardRow, sanitize: boolean): string {
  const label = sanitize ? sanitizeCardLabel(row.label) : row.label;
  const value = sanitize ? sanitizeCardValue(row.value) : row.value;
  const normalizedLabel = label.trim();
  const normalizedValue = value.trim();
  if (normalizedLabel.length === 0 && normalizedValue.length === 0) {
    return "";
  }
  if (normalizedValue.length === 0) {
    return `${label}:`;
  }
  if (normalizedLabel.length === 0) {
    return value;
  }
  return `${label}: ${value}`;
}

function sanitizeCardLabel(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sanitizeCardTitle(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function sanitizeCardValue(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replaceAll(/[\r\n\t]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}
