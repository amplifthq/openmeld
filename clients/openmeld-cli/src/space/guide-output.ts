import type { SpaceMeta } from "@openmeld/protocol";
import type { StructuredGuidePayload } from "@openmeld/schemas/types";
import pc from "picocolors";
import type { Presenter } from "../runtime/presenter";
import { buildStructuredGuidePayload } from "../runtime/structured-guide-payload";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

export function emitSpaceGuideHumanOutput(input: {
  presenter: Presenter;
  meta: SpaceMeta;
  title?: string;
}): void {
  const guideText = normalizeGuideText(input.meta.guide);
  renderInfoCard({
    presenter: input.presenter,
    title: input.title ?? "Space guide:",
    codePrefix: "space.guide.card",
    rows: buildSpaceGuideCardRows({
      meta: input.meta,
      guideText,
    }),
    minContentWidth: 56,
  });
}

export function buildSpaceGuideStructuredPayload(input: {
  spaceId: string;
  spaceName?: string | null;
  guideText?: string | null;
}): StructuredGuidePayload {
  const spaceLabel = resolveSpaceLabel(input.spaceId, input.spaceName);
  const guideText = normalizeGuideText(input.guideText);
  const humanSteps = guideText
    ? guideText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : ["No guide is set for this space yet."];

  return buildStructuredGuidePayload({
    summary: guideText
      ? `Space guide for ${spaceLabel}.`
      : `No space guide is set for ${spaceLabel}.`,
    humanSteps,
    agentCommands: [
      `openmeld space guide --view agent ${input.spaceId}`,
      `openmeld space guide set --view agent ${input.spaceId} "<guide text>"`,
      `openmeld space contract --view agent ${input.spaceId}`,
      `openmeld space status --view agent ${input.spaceId}`,
      "openmeld prompt space --raw",
    ],
    notes: guideText
      ? [
          "Use `openmeld space guide clear <space-id>` to remove the current guide.",
        ]
      : [
          'Use `openmeld space guide set <space-id> "<guide text>"` to add a guide.',
        ],
  });
}

function buildSpaceGuideCardRows(input: {
  meta: SpaceMeta;
  guideText: string | null;
}): InfoCardRow[] {
  const spaceLabel = resolveSpaceLabel(input.meta.spaceId, input.meta.name);
  return [
    {
      label: pc.dim("Space"),
      value: pc.bold(pc.cyan(spaceLabel)),
    },
    ...(input.meta.name
      ? [
          {
            label: pc.dim("Space ID"),
            value: pc.dim(input.meta.spaceId),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Guide"),
      value: input.guideText ? pc.bold(pc.green("set")) : pc.dim("empty"),
    },
    ...(typeof input.meta.passwordProtected === "boolean"
      ? [
          {
            label: pc.dim("Security"),
            value: input.meta.passwordProtected
              ? pc.bold(pc.yellow("password-protected"))
              : pc.dim("open"),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(input.meta.updatedAt
      ? [
          {
            label: pc.dim("Updated at"),
            value: pc.dim(input.meta.updatedAt),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(input.guideText
      ? [
          {
            label: "",
            value: "",
          } satisfies InfoCardRow,
          {
            label: "",
            value: pc.bold("Guide text"),
          } satisfies InfoCardRow,
          ...input.guideText.split("\n").map((line) => ({
            label: "",
            value: line.length > 0 ? line : " ",
          })),
        ]
      : []),
  ];
}

function resolveSpaceLabel(spaceId: string, spaceName?: string | null): string {
  const normalizedName = normalizeGuideText(spaceName);
  return normalizedName ?? spaceId;
}

function normalizeGuideText(value: string | null | undefined): string | null {
  const normalized = sanitizeTerminalDisplayText(
    value ?? "",
    "multi-line"
  ).trim();
  return normalized.length > 0 ? normalized : null;
}
