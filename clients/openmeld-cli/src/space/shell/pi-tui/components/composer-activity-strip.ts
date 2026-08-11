import { stripVTControlCharacters } from "node:util";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { colorizeAgentLabel } from "../../../../ui/profile-label-color";
import { buildSpacePrimaryMentionLabelByProfileId } from "../../../mention-label-state";
import type {
  ComposerActivityRowViewState,
  ComposerActivityViewState,
} from "../../../view/space-session-view-state";
import { spacePiTuiTheme } from "../theme";

const STRIP_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const STRIP_TICK_MS = 150;
const STATUS_LABEL_CYCLE_SECONDS = 3;
const STATUS_LABELS = ["replying", "thinking", "working"] as const;
const STATUS_TRAILING_DOT_FRAMES = [".", "..", "..."] as const;
const PREVIEW_GAP = "   ";
const ACTIVITY_TARGET_LABEL_PREFIX_REGEX = /^@/u;
const mentionLabelsBySnapshot = new WeakMap<
  SpaceMembersSnapshot,
  ReadonlyMap<string, string>
>();

export class ComposerActivityStrip implements Component {
  readonly #tui: TUI;
  #activity: ComposerActivityViewState = {
    visible: false,
    mode: "idle",
    rows: [],
    overflowCount: 0,
    actors: [],
    leadActor: null,
    elapsedSeconds: null,
    previewText: "",
    hint: null,
  };
  #activityBaseSetAtMs = Date.now();
  #tick = 0;
  #timer: NodeJS.Timeout | null = null;

  constructor(tui: TUI) {
    this.#tui = tui;
  }

  setActivity(activity: ComposerActivityViewState): void {
    const wasWaiting = isWaitingComposerActivity(this.#activity);
    const isWaiting = isWaitingComposerActivity(activity);
    if (!wasWaiting && isWaiting) {
      this.#tick = 0;
    }
    this.#activity = activity;
    this.#activityBaseSetAtMs = Date.now();
    this.#syncTimer();
    this.#tui.requestRender();
  }

  stop(): void {
    if (!this.#timer) {
      return;
    }
    clearInterval(this.#timer);
    this.#timer = null;
  }

  invalidate(): void {
    // No child components to invalidate; requestRender is driven by timer/setActivity.
  }

  render(width: number): string[] {
    if (!shouldRenderComposerActivity(this.#activity)) {
      return [];
    }

    const inlineLines = buildActivityLines({
      activity: this.#activity,
      tick: this.#tick,
      elapsedDeltaSeconds: this.#resolveElapsedDeltaSeconds(),
      width,
    });
    return ["", ...inlineLines];
  }

  #syncTimer(): void {
    if (shouldAnimateComposerActivity(this.#activity)) {
      if (this.#timer) {
        return;
      }
      this.#timer = setInterval(() => {
        this.#tick += 1;
        this.#tui.requestRender();
      }, STRIP_TICK_MS);
      return;
    }
    this.stop();
  }

  #resolveElapsedDeltaSeconds(): number {
    if (!shouldRenderComposerActivity(this.#activity)) {
      return 0;
    }
    return Math.max(
      0,
      Math.floor((Date.now() - this.#activityBaseSetAtMs) / 1000)
    );
  }
}

function shouldRenderComposerActivity(
  activity: ComposerActivityViewState
): boolean {
  return (
    activity.visible && activity.mode !== "idle" && activity.rows.length > 0
  );
}

function shouldAnimateComposerActivity(
  activity: ComposerActivityViewState
): boolean {
  return (
    shouldRenderComposerActivity(activity) &&
    activity.rows.some((row) => row.mode !== "warning")
  );
}

function isWaitingComposerActivity(
  activity: ComposerActivityViewState
): boolean {
  return (
    shouldRenderComposerActivity(activity) &&
    activity.rows.some(
      (row) => row.mode !== "warning" && row.previewText.trim().length === 0
    )
  );
}

function buildReplyingStatusLine(input: {
  row: ComposerActivityRowViewState;
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
  elapsedSeconds: number;
  tick: number;
}): string {
  const actors = input.row.actors
    .map((actor) => {
      const matchingAgent =
        input.spaceMembersSnapshot?.agents.find(
          (candidate) => candidate.profileId === actor.profileId
        ) ?? null;
      return colorizeAgentLabel(
        actor.label,
        {
          agentControllerRef: matchingAgent?.agentControllerRef,
          profileId: actor.profileId,
          profileName: actor.label,
        },
        {
          spaceMembersSnapshot: input.spaceMembersSnapshot,
        }
      );
    })
    .join(pc.dim(", "));
  const linkingVerb = input.row.actors.length > 1 ? "are" : "is";
  const modeLabel = resolveStatusModeLabel({
    elapsedSeconds: input.elapsedSeconds,
    previewText: input.row.previewText,
  });
  const modeSuffix =
    input.row.previewText.trim().length > 0
      ? ""
      : resolveAnimatedStatusDots(input.tick);
  return `${actors} ${pc.dim(linkingVerb)} ${pc.dim(`${modeLabel}${modeSuffix}`)}`;
}

function buildActivityLines(input: {
  activity: ComposerActivityViewState;
  tick: number;
  elapsedDeltaSeconds: number;
  width: number;
}): string[] {
  const lines: string[] = [];
  if (input.activity.overflowCount > 0) {
    lines.push(pc.dim(`+${input.activity.overflowCount} more active`));
  }

  for (const row of input.activity.rows) {
    const inlineLine = buildActivityRowLine({
      row,
      spaceMembersSnapshot: input.activity.spaceMembersSnapshot,
      tick: input.tick,
      elapsedSeconds: resolveRowElapsedSeconds({
        row,
        elapsedDeltaSeconds: input.elapsedDeltaSeconds,
      }),
      width: input.width,
    });
    const wrappedLines = wrapAnsi(inlineLine, Math.max(1, input.width), {
      hard: true,
      trim: false,
      wordWrap: true,
    }).split("\n");
    lines.push(...wrappedLines);
  }

  return lines;
}

function buildActivityRowLine(input: {
  row: ComposerActivityRowViewState;
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
  tick: number;
  elapsedSeconds: number;
  width: number;
}): string {
  const spinner =
    STRIP_SPINNER_FRAMES[input.tick % STRIP_SPINNER_FRAMES.length] ?? "⠋";
  if (input.row.mode === "sending") {
    return buildSendingStatusLine({
      row: input.row,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
      spinner,
    });
  }

  if (
    input.row.mode === "dispatching" ||
    input.row.mode === "retrying" ||
    input.row.mode === "warning"
  ) {
    const glyph =
      input.row.mode === "warning"
        ? pc.yellow("!")
        : spacePiTuiTheme.accentText(spinner);
    const elapsedLabel =
      input.row.mode === "warning"
        ? pc.dim("now")
        : pc.dim(`${input.elapsedSeconds}s`);
    return buildStatusHintLine({
      glyph,
      elapsedLabel,
      row: input.row,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    });
  }

  const statusLine = [
    spacePiTuiTheme.accentText(spinner),
    pc.dim(`${input.elapsedSeconds}s`),
    buildReplyingStatusLine({
      row: input.row,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
      elapsedSeconds: input.elapsedSeconds,
      tick: input.tick,
    }),
  ].join(` ${pc.dim("·")} `);

  const previewText = input.row.previewText.trim();
  if (!previewText) {
    return statusLine;
  }

  const separator = ` ${pc.dim("·")} `;
  const availableWidth = Math.max(
    0,
    input.width -
      stringWidth(stripVTControlCharacters(statusLine)) -
      stringWidth(stripVTControlCharacters(separator))
  );
  if (availableWidth <= 0) {
    return statusLine;
  }
  const windowText = selectPreviewWindow({
    text: previewText,
    tick: input.tick,
    width: availableWidth,
  });
  return `${statusLine}${separator}${pc.dim(windowText)}`;
}

function buildSendingStatusLine(input: {
  row: ComposerActivityRowViewState;
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
  spinner: string;
}): string {
  const sendingText = input.row.hint || "sending...";
  return [
    spacePiTuiTheme.accentText(input.spinner),
    formatHintWithColoredTargetLabel({
      hint: sendingText,
      targetLabel: input.row.targetLabel,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    }),
  ].join(` ${pc.dim("·")} `);
}

function buildStatusHintLine(input: {
  glyph: string;
  elapsedLabel: string;
  row: ComposerActivityRowViewState;
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
}): string {
  return [
    input.glyph,
    input.elapsedLabel,
    formatHintWithColoredTargetLabel({
      hint: input.row.hint ?? "",
      targetLabel: input.row.targetLabel,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    }),
  ].join(` ${pc.dim("·")} `);
}

function formatHintWithColoredTargetLabel(input: {
  hint: string;
  targetLabel: string | null;
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
}): string {
  const targetLabel = input.targetLabel?.trim() ?? "";
  if (!(targetLabel && input.hint.includes(targetLabel))) {
    return pc.white(input.hint);
  }

  const coloredTargetLabel = resolveColoredTargetLabel({
    spaceMembersSnapshot: input.spaceMembersSnapshot,
    targetLabel,
  });
  const [prefix, suffix = ""] = input.hint.split(targetLabel, 2);
  return `${pc.white(prefix)}${coloredTargetLabel}${pc.white(suffix)}`;
}

function resolveColoredTargetLabel(input: {
  spaceMembersSnapshot: ComposerActivityViewState["spaceMembersSnapshot"];
  targetLabel: string;
}): string {
  const normalizedTargetLabel = normalizeActivityTargetLabel(input.targetLabel);
  const mentionLabels = resolveMentionLabelsForSnapshot(
    input.spaceMembersSnapshot ?? null
  );
  const matchingAgent =
    input.spaceMembersSnapshot?.agents.find((candidate) => {
      const mentionLabel = mentionLabels?.get(candidate.profileId) ?? null;
      return [mentionLabel, candidate.profileName, candidate.profileId].some(
        (value) => normalizeActivityTargetLabel(value) === normalizedTargetLabel
      );
    }) ?? null;

  return colorizeAgentLabel(
    input.targetLabel,
    {
      agentControllerRef: matchingAgent?.agentControllerRef,
      profileId: matchingAgent?.profileId,
      profileName:
        matchingAgent?.profileName ||
        normalizedTargetLabel ||
        input.targetLabel,
    },
    {
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    }
  );
}

function resolveMentionLabelsForSnapshot(
  snapshot: ComposerActivityViewState["spaceMembersSnapshot"]
): ReadonlyMap<string, string> | null {
  if (!snapshot) {
    return null;
  }
  const cachedLabels = mentionLabelsBySnapshot.get(snapshot);
  if (cachedLabels) {
    return cachedLabels;
  }
  const resolvedLabels = buildSpacePrimaryMentionLabelByProfileId(snapshot);
  mentionLabelsBySnapshot.set(snapshot, resolvedLabels);
  return resolvedLabels;
}

function normalizeActivityTargetLabel(
  value: string | null | undefined
): string {
  return stripVTControlCharacters(String(value ?? ""))
    .trim()
    .replace(ACTIVITY_TARGET_LABEL_PREFIX_REGEX, "");
}

function resolveRowElapsedSeconds(input: {
  row: ComposerActivityRowViewState;
  elapsedDeltaSeconds: number;
}): number {
  return (input.row.elapsedSeconds ?? 0) + input.elapsedDeltaSeconds;
}

function resolveStatusModeLabel(input: {
  elapsedSeconds: number;
  previewText: string;
}): string {
  if (input.previewText.trim().length > 0) {
    return "streaming";
  }
  const cycleIndex =
    Math.floor(input.elapsedSeconds / STATUS_LABEL_CYCLE_SECONDS) %
    STATUS_LABELS.length;
  return STATUS_LABELS[cycleIndex] ?? STATUS_LABELS[0];
}

function resolveAnimatedStatusDots(tick: number): string {
  return (
    STATUS_TRAILING_DOT_FRAMES[tick % STATUS_TRAILING_DOT_FRAMES.length] ?? "."
  );
}

function selectPreviewWindow(input: {
  text: string;
  tick: number;
  width: number;
}): string {
  if (stringWidth(input.text) <= input.width) {
    return input.text;
  }

  const content = `${input.text}${PREVIEW_GAP}`;
  const characters = Array.from(content);
  const offset = input.tick % characters.length;
  const rotated = [...characters.slice(offset), ...characters.slice(0, offset)];
  let visibleWidth = 0;
  let rendered = "";

  for (const character of rotated) {
    const characterWidth = stringWidth(character);
    if (visibleWidth + characterWidth > input.width) {
      break;
    }
    rendered += character;
    visibleWidth += characterWidth;
  }

  return rendered || input.text;
}
