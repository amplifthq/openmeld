import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { renderOpenMeldBrandAccent } from "../../../../ui/brand";
import { renderPositiveAccentText } from "../../../../ui/positive-accent";
import type {
  SessionHeaderDocumentBlockViewState,
  SpaceSummaryFactsViewState,
} from "../../../view/space-session-view-state";

const HEADER_TOP_COPY_GAP = 2;
const LOGO_VERSION_GAP = "  ";
const LOGO_VERSION_MIN_GAP = "";
const SUMMARY_ROW_GAP = 2;
const SEPARATOR_CHAR = "─";
const DEFAULT_SPACE_NAME = "Untitled Space";
const CURRENT_SPACE_PREFIX = "Current Space › ";
const PUBLIC_SPACE_HINT =
  "Untrusted space. Anyone with this Space ID can join.";
const SECURE_SPACE_HINT = "Password protected. Space ID and password required.";

export function renderSessionHeaderLines(input: {
  block: SessionHeaderDocumentBlockViewState;
  width: number;
}): string[] {
  const width = Math.max(1, input.width);

  const lines = [
    ...renderTopCopyLine({
      leftText: input.block.productLabel,
      rightText: input.block.tagline,
      width,
    }),
    "",
    ...renderCenteredLogoLines({
      logoLines: input.block.logoLines,
      versionLabel: input.block.versionLabel,
      width,
    }),
    "",
    ...renderSummaryHeaderLines({
      facts: input.block.summaryFacts,
      summaryHintText: input.block.summaryHintText ?? null,
      width,
    }),
  ];

  return lines;
}

function renderTopCopyLine(input: {
  leftText: string;
  rightText: string;
  width: number;
}): string[] {
  const leftText = renderOpenMeldBrandAccent(input.leftText);
  const rightText = renderOpenMeldBrandAccent(input.rightText);
  const leftWidth = measureVisibleWidth(leftText);
  const rightWidth = measureVisibleWidth(rightText);
  const availableGapWidth = input.width - leftWidth - rightWidth;

  if (availableGapWidth >= HEADER_TOP_COPY_GAP) {
    return [`${leftText}${" ".repeat(availableGapWidth)}${rightText}`];
  }

  return [leftText, alignRight(rightText, input.width)];
}

function renderCenteredLogoLines(input: {
  logoLines: readonly string[];
  versionLabel: string | null;
  width: number;
}): string[] {
  const renderedLines: string[] = [];
  const lastLineIndex = input.logoLines.length - 1;

  for (const [index, line] of input.logoLines.entries()) {
    const isLastLine = index === lastLineIndex;
    const versionLabel = isLastLine ? input.versionLabel : null;
    renderedLines.push(
      ...renderCenteredLogoLine(line, versionLabel, input.width)
    );
  }

  return renderedLines;
}

function renderCenteredLogoLine(
  logoLine: string,
  versionLabel: string | null,
  width: number
): string[] {
  const logoWidth = measureVisibleWidth(logoLine);
  const baseLeftPadding = Math.max(0, Math.floor((width - logoWidth) / 2));
  const leftPadding = baseLeftPadding;
  const centeredLogoLine = `${" ".repeat(leftPadding)}${logoLine}`;

  if (!versionLabel) {
    return [centeredLogoLine];
  }

  const styledVersionLabel = pc.dim(versionLabel);
  const versionWidth = measureVisibleWidth(styledVersionLabel);
  const inlinePlacement = resolveInlineVersionPlacement({
    logoWidth,
    versionWidth,
    width,
    baseLeftPadding,
  });

  if (inlinePlacement) {
    const alignedLogoLine = `${" ".repeat(inlinePlacement.leftPadding)}${logoLine}`;
    return [
      `${alignedLogoLine}${inlinePlacement.gapText}${styledVersionLabel}`,
    ];
  }

  const versionIndent = Math.max(
    0,
    Math.min(
      width - versionWidth,
      leftPadding + Math.max(0, logoWidth - versionWidth)
    )
  );

  return [
    centeredLogoLine,
    `${" ".repeat(versionIndent)}${styledVersionLabel}`,
  ];
}

function resolveInlineVersionPlacement(input: {
  logoWidth: number;
  versionWidth: number;
  width: number;
  baseLeftPadding: number;
}): { leftPadding: number; gapText: string } | null {
  for (const gapText of [LOGO_VERSION_GAP, LOGO_VERSION_MIN_GAP]) {
    const maxLeftPadding =
      input.width - input.logoWidth - gapText.length - input.versionWidth;
    if (maxLeftPadding < 0) {
      continue;
    }

    return {
      leftPadding: Math.min(input.baseLeftPadding, maxLeftPadding),
      gapText,
    };
  }

  return null;
}

function renderSummaryHeaderLines(input: {
  facts: SpaceSummaryFactsViewState;
  summaryHintText: string | null;
  width: number;
}): string[] {
  const securitySummary = buildSecuritySummary(input.facts);
  const lines = [
    ...renderSplitLine({
      leftText: resolveSpaceNameText(input.facts),
      rightText: pc.dim(input.facts.spaceId),
      width: input.width,
      minGapWidth: SUMMARY_ROW_GAP,
    }),
    pc.dim(SEPARATOR_CHAR.repeat(input.width)),
  ];

  const detailLines = renderSummaryDetailLines({
    leftText: buildPresenceSummaryText(input.facts, input.summaryHintText),
    rightText: buildSecuritySummaryInlineText(securitySummary),
    width: input.width,
  });

  if (detailLines.length > 0) {
    lines.push(...detailLines);
  }

  lines.push("");
  return lines;
}

function renderSplitLine(input: {
  leftText: string;
  rightText: string;
  width: number;
  minGapWidth: number;
}): string[] {
  const leftText = input.leftText.trim();
  const rightText = input.rightText.trim();

  if (!(leftText || rightText)) {
    return [];
  }
  if (!rightText) {
    return wrapText(leftText, input.width);
  }
  if (!leftText) {
    return renderRightAlignedWrappedText(rightText, input.width);
  }

  const leftWidth = measureVisibleWidth(leftText);
  const rightWidth = measureVisibleWidth(rightText);
  const availableGapWidth = input.width - leftWidth - rightWidth;

  if (availableGapWidth >= input.minGapWidth) {
    return [`${leftText}${" ".repeat(availableGapWidth)}${rightText}`];
  }

  return [
    ...wrapText(leftText, input.width),
    ...renderRightAlignedWrappedText(rightText, input.width),
  ];
}

function renderSummaryDetailLines(input: {
  leftText: string;
  rightText: string;
  width: number;
}): string[] {
  const leftText = input.leftText.trim();
  const rightText = input.rightText.trim();

  if (!(leftText || rightText)) {
    return [];
  }
  if (!rightText) {
    return wrapText(leftText, input.width);
  }
  if (!leftText) {
    return renderRightAlignedWrappedText(rightText, input.width);
  }

  return renderSplitLine({
    leftText,
    rightText,
    width: input.width,
    minGapWidth: SUMMARY_ROW_GAP,
  });
}

function resolveSpaceNameText(facts: SpaceSummaryFactsViewState): string {
  return `${pc.dim(CURRENT_SPACE_PREFIX)}${facts.spaceName ?? DEFAULT_SPACE_NAME}`;
}

function buildSecuritySummary(facts: SpaceSummaryFactsViewState): {
  labelText: string;
  detailText: string;
} {
  switch (facts.securityLabel) {
    case "Secure":
      return {
        labelText: renderPositiveAccentText("🔒 Secure"),
        detailText: SECURE_SPACE_HINT,
      };
    case "Public":
      return {
        labelText: pc.yellow("⚠️ Public"),
        detailText: PUBLIC_SPACE_HINT,
      };
    default:
      return {
        labelText: pc.dim("Security unavailable"),
        detailText: "",
      };
  }
}

function buildSecuritySummaryInlineText(input: {
  labelText: string;
  detailText: string;
}): string {
  if (!input.detailText) {
    return input.labelText;
  }
  return `${input.labelText}${pc.dim(` · ${input.detailText}`)}`;
}

function buildPresenceSummaryText(
  facts: SpaceSummaryFactsViewState,
  summaryHintText: string | null
): string {
  const parts: string[] = [];

  if (
    typeof facts.membersCount === "number" &&
    Number.isFinite(facts.membersCount)
  ) {
    parts.push(`👥 ${facts.membersCount}`);
  }

  if (
    typeof facts.liveHumanCount === "number" &&
    Number.isFinite(facts.liveHumanCount)
  ) {
    parts.push(
      `${facts.liveHumanCount} live ${facts.liveHumanCount === 1 ? "human" : "humans"}`
    );
  }

  if (parts.length === 0) {
    return "";
  }

  if (!summaryHintText) {
    return parts.join(" · ");
  }

  return `${parts.join(" · ")}${pc.dim(` · ${summaryHintText}`)}`;
}

function wrapText(text: string, width: number): string[] {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }

  return wrapAnsi(normalizedText, Math.max(1, width), {
    hard: true,
    trim: false,
    wordWrap: true,
  }).split("\n");
}

function renderRightAlignedWrappedText(text: string, width: number): string[] {
  return wrapText(text, width).map((line) => alignRight(line, width));
}

function alignRight(text: string, width: number): string {
  const visibleWidth = measureVisibleWidth(text);
  return `${" ".repeat(Math.max(0, width - visibleWidth))}${text}`;
}

function measureVisibleWidth(text: string): number {
  return stringWidth(stripVTControlCharacters(text));
}
