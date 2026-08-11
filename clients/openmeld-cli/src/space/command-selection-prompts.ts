import { cancel, isCancel, multiselect, select, text } from "@clack/prompts";
import pc from "picocolors";
import { formatMessage } from "../runtime/messages";
import type { createPresenter } from "../runtime/presenter/index";
import {
  promptSearchMultiselect,
  promptSearchSelect,
} from "../ui/search-select";
import { promptTextEntry } from "../ui/text-entry";
import { normalizeOptionalString } from "./command-http-errors";
import {
  isInputClosed,
  isValidSpaceId,
  sanitizeSingleLinePromptText,
  shortenSpaceId,
} from "./command-input-normalizers";
import {
  buildKnownSpaceDisplayProjection,
  formatKnownSpaceName,
  formatKnownSpaceOptionLabel,
  type KnownSpaceDeletedNotice,
  type KnownSpaceOption,
  type KnownSpaceVisibilityScope,
  normalizeKnownSpaceVisibilityScope,
  resolveKnownSpaceJoinedTimestamp,
} from "./command-known-space-projection";
import {
  isLocalSpaceStateCorruptResult,
  readSpaceCacheDeletionNoticeState,
  toLocalSpaceStateIntegrityError,
  writeSpaceCacheDeletionNoticeState,
} from "./local-state";
import { formatSpaceDisplayValue } from "./space-display-projection";

export type SpaceDeleteTarget = {
  space: string;
  baseUrl?: string;
  name?: string | null;
  creatorProfileName?: string | null;
  creatorProfileId?: string | null;
  creatorOwnerUserId?: string | null;
  creatorKind?: string | null;
};

export type SpaceDeleteTargetSelectionResult =
  | {
      status: "submitted";
      targets: SpaceDeleteTarget[];
      allowBackToSelection: boolean;
    }
  | { status: "back" }
  | { status: "cancelled" };

export type SpaceJoinTargetResolution =
  | {
      status: "submitted";
      value: SpaceSelectionTarget;
    }
  | {
      status: "cancelled" | "back" | "create";
      value: null;
    };

async function consumeKnownSpaceDeletedNoticePromptLines(input: {
  openMeldProfileId: string;
  deletedNotices: KnownSpaceDeletedNotice[];
}): Promise<string[]> {
  if (input.deletedNotices.length === 0) {
    return [];
  }

  await markKnownSpaceDeletedNoticesSeen({
    openMeldProfileId: input.openMeldProfileId,
    deletedNotices: input.deletedNotices,
  });
  return [formatKnownSpaceDeletedNoticeMessage(input.deletedNotices)];
}

export async function maybeEmitKnownSpaceDeletedNotices(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  openMeldProfileId: string;
  deletedNotices: KnownSpaceDeletedNotice[];
}): Promise<void> {
  if (input.deletedNotices.length === 0) {
    return;
  }

  if (input.resolvedView === "human") {
    input.presenter.line({
      code: "space.deleted_notices",
      text: formatKnownSpaceDeletedNoticeMessage(input.deletedNotices),
    });
    await markKnownSpaceDeletedNoticesSeen({
      openMeldProfileId: input.openMeldProfileId,
      deletedNotices: input.deletedNotices,
    });
    return;
  }

  input.presenter.data({
    code: "space.deleted_notices",
    payload: {
      deletedNotices: input.deletedNotices.map((item) =>
        buildKnownSpaceDeletedNoticeData(item)
      ),
    },
  });
}

function formatKnownSpaceDeletedNoticeMessage(
  deletedNotices: KnownSpaceDeletedNotice[]
): string {
  const visible = deletedNotices
    .slice(0, 3)
    .map((item) => formatKnownSpaceDeletedNoticeLabel(item, "human"));
  const suffix =
    deletedNotices.length > visible.length
      ? `, +${String(deletedNotices.length - visible.length)} more`
      : "";
  return `Removed from your space list: ${visible.join(", ")}${suffix}.`;
}

function formatKnownSpaceDeletedNoticeLabel(
  item: KnownSpaceDeletedNotice,
  resolvedView: "human" | "agent"
): string {
  const name =
    sanitizeSingleLinePromptText(item.spaceName) ||
    shortenSpaceId(item.spaceId);
  const deletedByName = normalizeOptionalString(item.deletedByProfileName);
  const deletedById = normalizeOptionalString(item.deletedByProfileId);

  if (resolvedView === "human") {
    return deletedByName
      ? `${name} (deleted by ${sanitizeSingleLinePromptText(deletedByName)})`
      : `${name} (deleted)`;
  }

  if (deletedByName && deletedById) {
    return `${name} (deleted by ${sanitizeSingleLinePromptText(deletedByName)} · ${sanitizeSingleLinePromptText(deletedById)})`;
  }
  if (deletedByName) {
    return `${name} (deleted by ${sanitizeSingleLinePromptText(deletedByName)})`;
  }
  if (deletedById) {
    return `${name} (deleted by ${sanitizeSingleLinePromptText(deletedById)})`;
  }
  return `${name} (deleted)`;
}

async function markKnownSpaceDeletedNoticesSeen(input: {
  openMeldProfileId: string;
  deletedNotices: KnownSpaceDeletedNotice[];
}): Promise<void> {
  if (input.deletedNotices.length === 0) {
    return;
  }

  const existingStateResult = await readSpaceCacheDeletionNoticeState({
    openMeldProfileId: input.openMeldProfileId,
  });
  if (isLocalSpaceStateCorruptResult(existingStateResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "marking known-space deletion notices as seen",
      result: existingStateResult,
    });
  }
  const existing =
    existingStateResult.kind === "ok" ? existingStateResult.value.seen : {};
  const seen = { ...existing };
  const now = new Date().toISOString();
  let changed = false;
  for (const item of input.deletedNotices) {
    const key = buildKnownSpaceDeletedNoticeStateKey({
      gatewayHost: item.gatewayHost,
      spaceId: item.spaceId,
    });
    if (typeof seen[key] === "string" && seen[key].trim().length > 0) {
      continue;
    }
    seen[key] = now;
    changed = true;
  }
  if (!changed) {
    return;
  }

  await writeSpaceCacheDeletionNoticeState({
    openMeldProfileId: input.openMeldProfileId,
    seen,
  }).catch(() => undefined);
}

function buildKnownSpaceDeletedNoticeStateKey(input: {
  gatewayHost: string;
  spaceId: string;
}): string {
  return `${input.gatewayHost}:${input.spaceId}`;
}

function buildKnownSpaceDeletedNoticeData(
  item: KnownSpaceDeletedNotice
): Record<string, unknown> {
  return {
    gatewayHost: item.gatewayHost,
    spaceId: item.spaceId,
    spaceName: item.spaceName,
    deletedAt: item.deletedAt,
    deletedByProfileName: item.deletedByProfileName,
    deletedByProfileId: item.deletedByProfileId,
  };
}

export type SpaceSelectionCommand =
  | "join"
  | "watch"
  | "guide"
  | "delete"
  | "password"
  | "add_members"
  | "remove_members"
  | "leave";

export type SpaceSelectionInput = {
  known: KnownSpaceOption[];
  deletedNotices?: KnownSpaceDeletedNotice[];
  command: SpaceSelectionCommand;
  passwordAction?: "set" | "clear";
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  visibilityScope?: KnownSpaceVisibilityScope;
  allowBack?: boolean;
};

export type SpaceSelectionTarget = {
  space: string;
  baseUrl?: string;
  name?: string;
};

export type SpaceSelectionTargetResult =
  | { status: "submitted"; target: SpaceSelectionTarget }
  | { status: "back" }
  | { status: "cancelled" };

type HumanManualSpaceIdResult =
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" };

type PasswordSpaceTargetSelectionResult =
  | { status: "submitted"; target: SpaceSelectionTarget }
  | { status: "back" }
  | { status: "cancelled" };

export function promptSpaceSelectionTarget(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  if (input.known.length === 0) {
    return promptSpaceSelectionWithoutKnownSpaces(input);
  }
  return promptKnownSpaceSelection(input);
}

export async function promptSpacePasswordTargetSelection(
  input: SpaceSelectionInput
): Promise<PasswordSpaceTargetSelectionResult> {
  if (input.known.length === 0) {
    const target = await promptSpaceSelectionWithoutKnownSpaces({
      ...input,
      allowBack: true,
    });
    if (target.status !== "submitted") {
      return target;
    }
    return { status: "submitted", target: target.target };
  }

  if (input.resolvedView === "human") {
    return promptHumanSpacePasswordTargetSelection(input);
  }
  return promptAgentSpacePasswordTargetSelection(input);
}

async function promptSpaceSelectionWithoutKnownSpaces(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  const emptyMessage = resolveEmptySpaceSelectionMessage(
    input.command,
    input.passwordAction,
    input.visibilityScope
  );
  if (input.command === "join" && input.resolvedView === "human") {
    const manual = await promptHumanManualSpaceId({
      message: emptyMessage,
      description: "Paste a 64-character hex space ID to join it.",
      allowBack: false,
    });
    if (manual.status !== "submitted") {
      return manual.status === "back"
        ? { status: "back" }
        : { status: "cancelled" };
    }
    return {
      status: "submitted",
      target: { space: manual.value },
    };
  }

  if (input.resolvedView === "human") {
    const manual = await promptHumanManualSpaceId({
      message: emptyMessage,
      description: "Paste a 64-character hex space ID.",
      allowBack: input.allowBack === true,
    });
    if (manual.status !== "submitted") {
      return manual;
    }
    return {
      status: "submitted",
      target: { space: manual.value },
    };
  }

  const manual = await promptManualSpace(emptyMessage, input.resolvedView);
  return manual
    ? {
        status: "submitted",
        target: { space: manual },
      }
    : {
        status: "cancelled",
      };
}

async function promptHumanSpacePasswordTargetSelection(
  input: SpaceSelectionInput
): Promise<PasswordSpaceTargetSelectionResult> {
  let noticeLines = await consumeKnownSpaceDeletedNoticePromptLines({
    openMeldProfileId: input.currentProfileId,
    deletedNotices: input.deletedNotices ?? [],
  });
  for (;;) {
    writeInteractivePromptSpacer();
    const selected = await promptSearchSelect({
      message: resolveSpaceSelectionMessage(
        input.command,
        input.passwordAction,
        input.visibilityScope,
        input.resolvedView
      ),
      items: buildHumanKnownSpaceSearchItems({
        known: input.known,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
        currentOwnerUserId: input.currentOwnerUserId,
        command: input.command,
      }),
      maxVisible: 8,
      allowBack: true,
      backLabel: "Back",
      noticeLines,
    });
    noticeLines = [];
    if (selected.status === "cancelled") {
      cancel("Cancelled.");
      return { status: "cancelled" };
    }
    if (selected.status === "back") {
      return { status: "back" };
    }
    if (selected.value === "manual") {
      const manual = await promptHumanManualSpaceId({
        message: "Enter a space ID manually",
        description: "Paste a 64-character hex space ID.",
        allowBack: true,
      });
      if (manual.status === "cancelled") {
        cancel("Cancelled.");
        return { status: "cancelled" };
      }
      if (manual.status === "back") {
        continue;
      }
      return {
        status: "submitted",
        target: { space: manual.value },
      };
    }

    const target = toSpaceSelectionTargetFromKnownValue(
      input.known,
      selected.value
    );
    if (!target) {
      continue;
    }
    return {
      status: "submitted",
      target,
    };
  }
}

async function promptAgentSpacePasswordTargetSelection(
  input: SpaceSelectionInput
): Promise<PasswordSpaceTargetSelectionResult> {
  const options = input.known.slice(0, 20).map((space, index) => ({
    label: formatKnownSpaceOptionLabel({
      space,
      resolvedView: input.resolvedView,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
      currentOwnerUserId: input.currentOwnerUserId,
      command: input.command,
    }),
    value: `known:${String(index)}`,
  }));
  options.push(
    {
      label: "Enter a space ID manually",
      value: "manual",
    },
    {
      label: "Back",
      value: "back",
    }
  );

  const selected = await select({
    message: resolveSpaceSelectionMessage(
      input.command,
      input.passwordAction,
      input.visibilityScope,
      input.resolvedView
    ),
    options,
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (selected === "back") {
    return { status: "back" };
  }
  if (selected === "manual") {
    const manual = await promptManualSpace(
      "Enter a space ID (64-character hex):",
      input.resolvedView
    );
    return manual
      ? {
          status: "submitted",
          target: { space: manual },
        }
      : { status: "cancelled" };
  }

  const target = toSpaceSelectionTargetFromKnownValue(input.known, selected);
  return target
    ? {
        status: "submitted",
        target,
      }
    : { status: "cancelled" };
}

export async function promptHumanJoinSelectionWithoutKnownSpaces(
  visibilityScope: KnownSpaceVisibilityScope
): Promise<SpaceJoinTargetResolution> {
  for (;;) {
    writeInteractivePromptSpacer();
    const selected = await select({
      message: [
        "No spaces yet",
        pc.dim(
          resolveSpaceVisibilitySummary({
            visibilityScope,
            resolvedView: "human",
          })
        ),
        pc.dim(
          "Paste a space ID someone shared with you, create a new space, or go back."
        ),
        "",
      ].join("\n"),
      options: [
        {
          value: "manual",
          label: "Enter a space ID manually",
          hint: "Best if someone shared a space ID with you",
        },
        {
          value: "create",
          label: "Create a new space and join",
          hint: "Fastest way to get started",
        },
        {
          value: "back",
          label: "Back",
          hint: "Return to the previous step",
        },
      ],
    });
    if (isCancel(selected)) {
      cancel("Cancelled.");
      return {
        status: "cancelled",
        value: null,
      };
    }
    if (selected === "back") {
      return {
        status: "back",
        value: null,
      };
    }
    if (selected === "create") {
      return {
        status: "create",
        value: null,
      };
    }

    const manual = await promptHumanManualSpaceId({
      message: "Enter a space ID manually",
      description: "Paste a 64-character hex space ID to join it.",
      allowBack: true,
    });
    if (manual.status === "submitted") {
      return {
        status: "submitted",
        value: { space: manual.value },
      };
    }
    if (manual.status === "cancelled") {
      cancel("Cancelled.");
      return {
        status: "cancelled",
        value: null,
      };
    }
  }
}

function resolveEmptySpaceSelectionMessage(
  command: SpaceSelectionCommand,
  passwordAction?: "set" | "clear",
  visibilityScope?: KnownSpaceVisibilityScope
): string {
  if (
    command === "join" ||
    command === "add_members" ||
    command === "remove_members" ||
    command === "leave"
  ) {
    if (normalizeKnownSpaceVisibilityScope(visibilityScope) === "owner") {
      return "No spaces across the profiles you own were found yet. Enter a space ID (64-character hex):";
    }
    return "No spaces for this profile were found yet. Enter a space ID (64-character hex):";
  }
  if (command === "delete") {
    return "No known spaces found yet. Enter a space ID (64-character hex):";
  }
  if (command === "password") {
    if (passwordAction === "clear") {
      return "No password-protected spaces created by this profile were found yet. Enter a space ID (64-character hex):";
    }
    if (passwordAction === "set") {
      return "No unprotected spaces created by this profile were found yet. Enter a space ID (64-character hex):";
    }
    return "No spaces created by this profile were found yet. Enter a space ID (64-character hex):";
  }
  return "No local spaces found yet. Enter a space ID (64-character hex):";
}

async function promptKnownSpaceSelection(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  if (
    input.resolvedView === "human" &&
    (input.command === "add_members" ||
      input.command === "remove_members" ||
      input.command === "leave" ||
      input.command === "watch")
  ) {
    return promptHumanKnownSpaceSelection(input);
  }

  const options = input.known.slice(0, 20).map((space, index) => ({
    label: formatKnownSpaceOptionLabel({
      space,
      resolvedView: input.resolvedView,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
      currentOwnerUserId: input.currentOwnerUserId,
      command: input.command,
    }),
    value: `known:${String(index)}`,
  }));
  options.push({
    label: "Enter a space ID manually",
    value: "manual",
  });
  if (input.allowBack === true) {
    options.push({
      label: "Back",
      value: "back",
    });
  }

  const selected = await select({
    message: resolveSpaceSelectionMessage(
      input.command,
      input.passwordAction,
      input.visibilityScope,
      input.resolvedView
    ),
    options,
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (selected === "back") {
    return { status: "back" };
  }
  if (selected === "manual") {
    const manual = await promptManualSpace(
      "Enter a space ID (64-character hex):",
      input.resolvedView
    );
    return manual
      ? {
          status: "submitted",
          target: { space: manual },
        }
      : {
          status: "cancelled",
        };
  }
  const target = toSpaceSelectionTargetFromKnownValue(input.known, selected);
  return target
    ? {
        status: "submitted",
        target,
      }
    : {
        status: "cancelled",
      };
}

function promptHumanKnownSpaceSelection(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  if (input.command === "watch") {
    return promptHumanWatchKnownSpaceSelection(input);
  }

  return promptHumanKnownSpaceSelectionWithInlineManual(input);
}

async function promptHumanWatchKnownSpaceSelection(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  const selected = await promptHumanKnownSpaceBrowseSelection({
    input,
    allowSourceBack: input.allowBack === true,
    manualDescription: "Paste a 64-character hex space ID.",
  });
  if (selected.status === "cancelled") {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (selected.status === "back") {
    return { status: "back" };
  }
  if (!selected.value) {
    return { status: "cancelled" };
  }
  return {
    status: "submitted",
    target: selected.value,
  };
}

async function promptHumanKnownSpaceSelectionWithInlineManual(
  input: SpaceSelectionInput
): Promise<SpaceSelectionTargetResult> {
  let noticeLines = await consumeKnownSpaceDeletedNoticePromptLines({
    openMeldProfileId: input.currentProfileId,
    deletedNotices: input.deletedNotices ?? [],
  });
  for (;;) {
    const selected = await promptSearchSelect({
      message: resolveSpaceSelectionMessage(
        input.command,
        input.passwordAction,
        input.visibilityScope,
        input.resolvedView
      ),
      items: buildHumanKnownSpaceSearchItems({
        known: input.known,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
        currentOwnerUserId: input.currentOwnerUserId,
        command: input.command,
      }),
      maxVisible: 8,
      allowBack: input.allowBack === true,
      backLabel: "Back",
      noticeLines,
    });
    noticeLines = [];
    if (selected.status === "cancelled") {
      cancel("Cancelled.");
      return { status: "cancelled" };
    }
    if (selected.status === "back") {
      return { status: "back" };
    }
    if (selected.value === "manual") {
      const manual = await promptHumanManualSpaceId({
        message: "Enter a space ID manually",
        description: "Paste a 64-character hex space ID.",
        allowBack: true,
      });
      if (manual.status === "cancelled") {
        cancel("Cancelled.");
        return { status: "cancelled" };
      }
      if (manual.status === "back") {
        continue;
      }
      return {
        status: "submitted",
        target: { space: manual.value },
      };
    }
    const target = toSpaceSelectionTargetFromKnownValue(
      input.known,
      selected.value
    );
    return target
      ? {
          status: "submitted",
          target,
        }
      : {
          status: "cancelled",
        };
  }
}

export async function promptSpaceJoinSelection(
  input: SpaceSelectionInput
): Promise<SpaceJoinTargetResolution> {
  if (input.resolvedView === "human") {
    const selected = await promptHumanKnownSpaceBrowseSelection({
      input,
      allowSourceBack: true,
      manualDescription: "Paste a 64-character hex space ID to join it.",
    });
    if (selected.status !== "submitted") {
      return {
        status: selected.status,
        value: null,
      };
    }
    if (!selected.value) {
      return {
        status: "cancelled",
        value: null,
      };
    }
    return {
      status: "submitted",
      value: selected.value,
    };
  }

  const knownSpaceOptions = input.known.map((space, index) => ({
    label: formatKnownSpaceOptionLabel({
      space,
      resolvedView: input.resolvedView,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
      currentOwnerUserId: input.currentOwnerUserId,
      command: input.command,
    }),
    value: `known:${String(index)}`,
  }));

  for (;;) {
    const source = await promptKnownSpaceSourceSelection({
      command: "join",
      knownCount: input.known.length,
      visibilityScope: input.visibilityScope,
      resolvedView: input.resolvedView,
      allowBack: true,
    });
    if (source === "cancelled") {
      cancel("Cancelled.");
      return {
        status: "cancelled",
        value: null,
      };
    }
    if (source === "back") {
      return {
        status: "back",
        value: null,
      };
    }

    const selectedTarget =
      source === "manual"
        ? await promptJoinManualTargetSelection(input.resolvedView)
        : await promptJoinKnownSpaceTargetSelection({
            input,
            knownSpaceOptions,
          });
    if (selectedTarget.status === "cancelled") {
      return {
        status: "cancelled",
        value: null,
      };
    }
    if (selectedTarget.status === "back" || selectedTarget.value === null) {
      continue;
    }
    return {
      status: "submitted",
      value: selectedTarget.value,
    };
  }
}

async function promptKnownSpaceSourceSelection(input: {
  command: "join" | "watch";
  knownCount: number;
  visibilityScope?: KnownSpaceVisibilityScope;
  resolvedView: "human" | "agent";
  allowBack: boolean;
}): Promise<"history" | "manual" | "back" | "cancelled"> {
  const selected = await select({
    message: resolveSpaceSelectionMessage(
      input.command,
      undefined,
      input.visibilityScope,
      input.resolvedView
    ),
    options: [
      {
        value: "history",
        label: resolveKnownSpaceHistoryOptionLabel(input.visibilityScope),
        hint: `${String(input.knownCount)} ${input.knownCount === 1 ? "space" : "spaces"}`,
      },
      {
        value: "manual",
        label: "Enter a space ID manually",
        hint: "Best if someone shared a space ID with you",
      },
      ...(input.allowBack
        ? [
            {
              value: "back",
              label: "Back",
              hint: "Return to the previous step",
            },
          ]
        : []),
    ],
  });
  if (isCancel(selected)) {
    return "cancelled";
  }
  if (selected === "back") {
    return "back";
  }
  if (selected === "history" || selected === "manual") {
    return selected;
  }
  return "cancelled";
}

function resolveKnownSpaceHistoryOptionLabel(
  visibilityScope?: KnownSpaceVisibilityScope
): string {
  return normalizeKnownSpaceVisibilityScope(visibilityScope) === "owner"
    ? "Choose a space from your profiles"
    : "Choose a space you created or joined";
}

async function promptJoinManualTargetSelection(
  resolvedView: "human" | "agent"
): Promise<{
  status: HumanManualSpaceIdResult["status"];
  value: SpaceSelectionTarget | null;
}> {
  if (resolvedView === "human") {
    const manual = await promptHumanManualSpaceId({
      message: "Enter a space ID manually",
      description: "Paste a 64-character hex space ID to join it.",
      allowBack: true,
    });
    if (manual.status !== "submitted") {
      return {
        status: manual.status,
        value: null,
      };
    }
    return {
      status: "submitted",
      value: { space: manual.value },
    };
  }

  const manual = await promptManualSpace(
    "Enter a space ID (64-character hex):",
    resolvedView
  );
  if (!manual) {
    return {
      status: "cancelled",
      value: null,
    };
  }
  return {
    status: "submitted",
    value: { space: manual },
  };
}

async function promptJoinKnownSpaceTargetSelection(input: {
  input: SpaceSelectionInput;
  knownSpaceOptions: Array<{ label: string; value: string }>;
}): Promise<{
  status: "submitted" | "back" | "cancelled";
  value: SpaceSelectionTarget | null;
}> {
  if (input.input.resolvedView === "human") {
    return promptHumanKnownSpaceSearchSelection({
      input: input.input,
      allowBack: true,
    });
  }

  const selected = await promptAgentSpaceJoinKnownSpaceSelection({
    knownSpaceOptions: input.knownSpaceOptions,
    visibilityScope: input.input.visibilityScope,
  });
  if (selected.status !== "submitted") {
    return {
      status: selected.status,
      value: null,
    };
  }
  return {
    status: "submitted",
    value: toSpaceSelectionTargetFromKnownValue(
      input.input.known,
      selected.value
    ),
  };
}

async function promptHumanKnownSpaceBrowseSelection(input: {
  input: SpaceSelectionInput;
  allowSourceBack: boolean;
  manualDescription: string;
}): Promise<
  | {
      status: "submitted";
      value: SpaceSelectionTarget | null;
    }
  | {
      status: "back" | "cancelled";
      value: null;
    }
> {
  for (;;) {
    const source = await promptKnownSpaceSourceSelection({
      command: input.input.command === "watch" ? "watch" : "join",
      knownCount: input.input.known.length,
      visibilityScope: input.input.visibilityScope,
      resolvedView: input.input.resolvedView,
      allowBack: input.allowSourceBack,
    });
    if (source === "cancelled") {
      return {
        status: "cancelled",
        value: null,
      };
    }
    if (source === "back") {
      return {
        status: "back",
        value: null,
      };
    }
    if (source === "manual") {
      const manual = await promptHumanManualSpaceId({
        message: "Enter a space ID manually",
        description: input.manualDescription,
        allowBack: true,
      });
      if (manual.status === "cancelled") {
        return {
          status: "cancelled",
          value: null,
        };
      }
      if (manual.status === "back") {
        continue;
      }
      return {
        status: "submitted",
        value: { space: manual.value },
      };
    }

    const selected = await promptHumanKnownSpaceSearchSelection({
      input: input.input,
      allowBack: true,
    });
    if (selected.status === "back") {
      continue;
    }
    return selected;
  }
}

async function promptHumanKnownSpaceSearchSelection(input: {
  input: SpaceSelectionInput;
  allowBack: boolean;
}): Promise<
  | {
      status: "submitted";
      value: SpaceSelectionTarget | null;
    }
  | {
      status: "back" | "cancelled";
      value: null;
    }
> {
  const noticeLines = await consumeKnownSpaceDeletedNoticePromptLines({
    openMeldProfileId: input.input.currentProfileId,
    deletedNotices: input.input.deletedNotices ?? [],
  });
  writeInteractivePromptSpacer();
  const selected = await promptSearchSelect({
    message: resolveSpaceSelectionMessage(
      input.input.command,
      input.input.passwordAction,
      input.input.visibilityScope,
      input.input.resolvedView
    ),
    items: input.input.known.map((space, index) =>
      buildHumanKnownSpaceSearchItem({
        space,
        index,
        currentProfileId: input.input.currentProfileId,
        currentProfileName: input.input.currentProfileName,
        currentOwnerUserId: input.input.currentOwnerUserId,
        command: input.input.command,
      })
    ),
    maxVisible: 8,
    allowBack: input.allowBack,
    backLabel: "Back",
    noticeLines,
  });
  if (selected.status !== "submitted") {
    return {
      status: selected.status,
      value: null,
    };
  }
  return {
    status: "submitted",
    value: toSpaceSelectionTargetFromKnownValue(
      input.input.known,
      selected.value
    ),
  };
}

function writeInteractivePromptSpacer(): void {
  if (process.stdout.isTTY !== true) {
    return;
  }
  process.stdout.write("\n");
}

async function promptAgentSpaceJoinKnownSpaceSelection(input: {
  knownSpaceOptions: Array<{ label: string; value: string }>;
  visibilityScope?: KnownSpaceVisibilityScope;
}): Promise<
  | {
      status: "submitted";
      value: string;
    }
  | {
      status: "cancelled";
      value: null;
    }
  | {
      status: "back";
      value: null;
    }
> {
  const selected = await select({
    message: resolveSpaceSelectionMessage(
      "join",
      undefined,
      input.visibilityScope,
      "agent"
    ),
    options: [
      ...input.knownSpaceOptions,
      {
        value: "back",
        label: "Back",
        hint: "Return to join options",
      },
    ],
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return {
      status: "cancelled",
      value: null,
    };
  }
  if (selected === "back") {
    return {
      status: "back",
      value: null,
    };
  }
  return {
    status: "submitted",
    value: selected,
  };
}

function toSpaceSelectionTargetFromKnownValue(
  known: KnownSpaceOption[],
  selectedValue: string
): SpaceSelectionTarget | null {
  const selectedIndex = Number.parseInt(
    selectedValue.replace("known:", ""),
    10
  );
  const matched = known[selectedIndex];
  if (!matched) {
    return null;
  }
  return {
    space: matched.space,
    ...(matched?.baseUrl ? { baseUrl: matched.baseUrl } : {}),
    ...(matched?.name ? { name: matched.name } : {}),
  };
}

function buildHumanKnownSpaceSearchItem(input: {
  space: KnownSpaceOption;
  index: number;
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): {
  value: string;
  label: string;
  detail: string;
  searchText: string;
} {
  return {
    value: `known:${String(input.index)}`,
    label: formatKnownSpaceName({
      space: input.space,
      resolvedView: "human",
      currentProfileId: input.currentProfileId,
      currentOwnerUserId: input.currentOwnerUserId,
      command: input.command,
    }),
    detail: buildHumanKnownSpaceDetailLine({
      space: input.space,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
      command: input.command,
    }),
    searchText: buildHumanKnownSpaceSearchText({
      space: input.space,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
    }),
  };
}

function buildHumanKnownSpaceSearchItems(input: {
  known: KnownSpaceOption[];
  currentProfileId: string;
  currentProfileName?: string;
  currentOwnerUserId?: string;
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): Array<{
  value: string;
  label: string;
  detail?: string;
  searchText: string;
}> {
  return [
    ...input.known.map((space, index) =>
      buildHumanKnownSpaceSearchItem({
        space,
        index,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
        currentOwnerUserId: input.currentOwnerUserId,
        command: input.command,
      })
    ),
    {
      value: "manual",
      label: "Enter a space ID manually",
      searchText: "Enter a space ID manually\nmanual\nspace id",
    },
  ];
}

function buildHumanKnownSpaceDetailLine(input: {
  space: KnownSpaceOption;
  currentProfileId: string;
  currentProfileName?: string;
  command?:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): string {
  const projection = buildKnownSpaceDisplayProjection({
    space: input.space,
    currentProfileId: input.currentProfileId,
    currentProfileName: input.currentProfileName,
  });
  const idLabel = `ID ${shortenSpaceId(formatSpaceDisplayValue(projection.spaceId))}`;
  const creatorLabel = projection.creatorDisplayName;
  const viaLabel = projection.availableViaDisplayName;
  const parts = [idLabel];
  if (creatorLabel) {
    parts.push(`Created by ${creatorLabel}`);
  }
  if (viaLabel && viaLabel !== creatorLabel) {
    parts.push(`via ${viaLabel}`);
  }
  const joinedLabel = formatJoinedRelativeLabel(
    resolveKnownSpaceJoinedTimestamp(input.space)
  );
  if (joinedLabel) {
    parts.push(sanitizeSingleLinePromptText(joinedLabel));
  }
  return parts.join(" · ");
}

function buildHumanKnownSpaceSearchText(input: {
  space: KnownSpaceOption;
  currentProfileId: string;
  currentProfileName?: string;
}): string {
  const projection = buildKnownSpaceDisplayProjection({
    space: input.space,
    currentProfileId: input.currentProfileId,
    currentProfileName: input.currentProfileName,
  });
  return [
    formatSpaceDisplayValue(projection.spaceId, ""),
    formatSpaceDisplayValue(projection.spaceName, ""),
    formatSpaceDisplayValue(projection.creatorProfileName, ""),
    formatSpaceDisplayValue(projection.creatorProfileId, ""),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(input.space.creatorOwnerUserId)
    ),
    formatSpaceDisplayValue(projection.availableViaProfileName, ""),
    formatSpaceDisplayValue(projection.availableViaProfileId, ""),
    formatSpaceDisplayValue(projection.creatorDisplayName, ""),
    formatSpaceDisplayValue(projection.availableViaDisplayName, ""),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function formatJoinedRelativeLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return "joined now";
  }
  if (elapsedMinutes < 60) {
    return `joined ${String(elapsedMinutes)}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `joined ${String(elapsedHours)}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `joined ${String(elapsedDays)}d ago`;
}

async function promptHumanManualSpaceId(input: {
  message: string;
  description: string;
  allowBack: boolean;
}): Promise<HumanManualSpaceIdResult> {
  const result = await promptTextEntry({
    message: input.message,
    description: input.description,
    placeholder: "e.g. 01234567...89abcdef",
    allowBack: input.allowBack,
    backLabel: "Back",
    validate: (value) =>
      isValidSpaceId(value)
        ? null
        : "Space ID must be a 64-character hex value.",
  });
  if (result.status === "cancelled") {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (result.status === "back") {
    return { status: "back" };
  }
  return {
    status: "submitted",
    value: result.value,
  };
}

export async function promptSpaceDeleteSelection(input: {
  known: KnownSpaceOption[];
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName: string;
  allowBack?: boolean;
}): Promise<SpaceDeleteTargetSelectionResult> {
  if (input.known.length === 0) {
    if (input.resolvedView === "human") {
      const manual = await promptHumanManualSpaceId({
        message:
          "No spaces you can delete were found. Enter a space ID manually",
        description: "Paste a 64-character hex space ID to delete it.",
        allowBack: input.allowBack === true,
      });
      if (manual.status !== "submitted") {
        return manual;
      }
      return {
        status: "submitted",
        allowBackToSelection: true,
        targets: [{ space: manual.value }],
      };
    }

    const manual = await promptManualSpace(
      "No spaces you can delete were found. Enter a space ID (64-character hex):",
      input.resolvedView
    );
    return manual
      ? {
          status: "submitted",
          allowBackToSelection: true,
          targets: [{ space: manual }],
        }
      : {
          status: "cancelled",
        };
  }

  if (input.resolvedView === "human") {
    return promptHumanSpaceDeleteSelection(input);
  }

  const knownSpaces = input.known.slice(0, 20);
  const selected = await multiselect({
    message: "Choose space(s) to delete",
    options: buildSpaceDeleteSelectionOptions({
      knownSpaces,
      resolvedView: input.resolvedView,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
    }),
    required: true,
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }

  const normalized = normalizeSpaceDeleteSelection(selected);
  const { targets, manualRequested } = toSpaceDeleteTargetsFromSelection({
    knownSpaces,
    selected: normalized,
  });

  if (manualRequested) {
    const manual = await promptManualSpace(
      "Enter a space ID (64-character hex):",
      input.resolvedView
    );
    if (!manual) {
      return { status: "cancelled" };
    }
    targets.push({ space: manual });
  }

  const deduped = dedupeSpaceDeleteTargets(targets);
  return deduped.length > 0
    ? {
        status: "submitted",
        targets: deduped,
        allowBackToSelection: true,
      }
    : { status: "cancelled" };
}

async function promptHumanSpaceDeleteSelection(input: {
  known: KnownSpaceOption[];
  currentProfileId: string;
  currentProfileName: string;
  allowBack?: boolean;
}): Promise<SpaceDeleteTargetSelectionResult> {
  let initialSelectedValues: string[] = [];

  for (;;) {
    const selected = await promptSearchMultiselect({
      message: "Choose space(s) to delete",
      items: [
        ...input.known.map((space, index) =>
          buildHumanSpaceDeleteSearchItem({
            space,
            index,
            currentProfileId: input.currentProfileId,
            currentProfileName: input.currentProfileName,
          })
        ),
        {
          value: "manual",
          label: "Enter a space ID manually",
          searchText: "Enter a space ID manually\nmanual\nspace id",
        },
      ],
      maxVisible: 8,
      required: true,
      initialSelectedValues,
      allowBack: input.allowBack === true,
      backLabel: "Back",
    });
    if (selected.status === "cancelled") {
      cancel("Cancelled.");
      return { status: "cancelled" };
    }
    if (selected.status === "back") {
      return { status: "back" };
    }

    const normalized = normalizeSpaceDeleteSelection(selected.value);
    const { targets, manualRequested } = toSpaceDeleteTargetsFromSelection({
      knownSpaces: input.known,
      selected: normalized,
    });
    if (!manualRequested) {
      const deduped = dedupeSpaceDeleteTargets(targets);
      return deduped.length > 0
        ? {
            status: "submitted",
            targets: deduped,
            allowBackToSelection: true,
          }
        : { status: "cancelled" };
    }

    const manual = await promptHumanManualSpaceId({
      message: "Enter a space ID manually",
      description:
        "Paste a 64-character hex space ID to add it to the delete list.",
      allowBack: true,
    });
    if (manual.status === "cancelled") {
      cancel("Cancelled.");
      return { status: "cancelled" };
    }
    if (manual.status === "back") {
      initialSelectedValues = normalized.filter((value) => value !== "manual");
      continue;
    }

    targets.push({ space: manual.value });
    const deduped = dedupeSpaceDeleteTargets(targets);
    return deduped.length > 0
      ? {
          status: "submitted",
          targets: deduped,
          allowBackToSelection: true,
        }
      : { status: "cancelled" };
  }
}

function buildHumanSpaceDeleteSearchItem(input: {
  space: KnownSpaceOption;
  index: number;
  currentProfileId: string;
  currentProfileName?: string;
}): {
  value: string;
  label: string;
  detail: string;
  searchText: string;
} {
  return {
    value: `known:${String(input.index)}`,
    label: formatKnownSpaceName({
      space: input.space,
      resolvedView: "human",
      currentProfileId: input.currentProfileId,
      command: "delete",
    }),
    detail: buildHumanKnownSpaceDetailLine({
      space: input.space,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
      command: "delete",
    }),
    searchText: buildHumanKnownSpaceSearchText({
      space: input.space,
      currentProfileId: input.currentProfileId,
      currentProfileName: input.currentProfileName,
    }),
  };
}

function buildSpaceDeleteSelectionOptions(input: {
  knownSpaces: KnownSpaceOption[];
  resolvedView: "human" | "agent";
  currentProfileId: string;
  currentProfileName: string;
}): Array<{ label: string; value: string }> {
  return [
    ...input.knownSpaces.map((space, index) => ({
      label: formatKnownSpaceOptionLabel({
        space,
        resolvedView: input.resolvedView,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
        command: "delete",
      }),
      value: `known:${String(index)}`,
    })),
    {
      label: "Enter a space ID manually",
      value: "manual",
    },
  ];
}

function toSpaceDeleteTargetsFromSelection(input: {
  knownSpaces: KnownSpaceOption[];
  selected: string[];
}): { targets: SpaceDeleteTarget[]; manualRequested: boolean } {
  const targets: SpaceDeleteTarget[] = [];
  let manualRequested = false;
  for (const item of input.selected) {
    if (item === "manual") {
      manualRequested = true;
      continue;
    }
    const selectedIndex = Number.parseInt(item.replace("known:", ""), 10);
    const matched = input.knownSpaces[selectedIndex];
    if (!matched) {
      continue;
    }
    targets.push(toSpaceDeleteTarget(matched));
  }
  return { targets, manualRequested };
}

export function toSpaceDeleteTarget(
  space: KnownSpaceOption
): SpaceDeleteTarget {
  return {
    space: space.space,
    ...(space.baseUrl ? { baseUrl: space.baseUrl } : {}),
    ...(space.name === undefined ? {} : { name: space.name }),
    ...(space.creatorProfileName === undefined
      ? {}
      : { creatorProfileName: space.creatorProfileName }),
    ...(space.creatorProfileId === undefined
      ? {}
      : { creatorProfileId: space.creatorProfileId }),
    ...(space.creatorOwnerUserId === undefined
      ? {}
      : { creatorOwnerUserId: space.creatorOwnerUserId }),
    ...(space.creatorKind === undefined
      ? {}
      : { creatorKind: space.creatorKind }),
  };
}

function normalizeSpaceDeleteSelection(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selected: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (!normalized || selected.includes(normalized)) {
      continue;
    }
    selected.push(normalized);
  }
  return selected;
}

function dedupeSpaceDeleteTargets(
  targets: SpaceDeleteTarget[]
): SpaceDeleteTarget[] {
  const deduped: SpaceDeleteTarget[] = [];
  const knownIds = new Set<string>();
  for (const target of targets) {
    const spaceId = target.space.trim().toLowerCase();
    if (!spaceId || knownIds.has(spaceId)) {
      continue;
    }
    knownIds.add(spaceId);
    deduped.push(target);
  }
  return deduped;
}

function resolveSpaceSelectionMessage(
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave",
  passwordAction?: "set" | "clear",
  visibilityScope?: KnownSpaceVisibilityScope,
  resolvedView: "human" | "agent" = "human"
): string {
  let message: string;
  if (command === "password") {
    if (passwordAction === "clear") {
      message =
        "Choose a password-protected space you created to clear password";
    } else if (passwordAction === "set") {
      message = "Choose an unprotected space you created to set password";
    } else {
      message = "Choose a space you created to configure password";
    }
  } else if (command === "add_members") {
    message = "Choose a space to add members";
  } else if (command === "remove_members") {
    message = "Choose a space to remove members";
  } else if (command === "leave") {
    message = "Choose a space to leave";
  } else {
    message = `Choose a space to ${command}`;
  }
  return applySpaceVisibilityToPromptMessage({
    message,
    command,
    visibilityScope,
    resolvedView,
  });
}

function applySpaceVisibilityToPromptMessage(input: {
  message: string;
  command: SpaceSelectionCommand;
  visibilityScope?: KnownSpaceVisibilityScope;
  resolvedView: "human" | "agent";
}): string {
  if (
    input.resolvedView !== "human" ||
    (input.command !== "join" &&
      input.command !== "watch" &&
      input.command !== "guide")
  ) {
    return input.message;
  }
  return [
    input.message,
    pc.dim(
      resolveSpaceVisibilitySummary({
        visibilityScope: input.visibilityScope,
        resolvedView: input.resolvedView,
      })
    ),
  ].join("\n");
}

export function resolveSpaceVisibilitySummary(input: {
  visibilityScope?: KnownSpaceVisibilityScope;
  resolvedView: "human" | "agent";
}): string {
  if (normalizeKnownSpaceVisibilityScope(input.visibilityScope) === "owner") {
    return "Showing spaces from your main profile and your other human and agent profiles.";
  }
  return input.resolvedView === "agent"
    ? "Showing spaces for this profile only."
    : "Showing spaces for this profile only.";
}

async function promptManualSpace(
  message: string,
  resolvedView: "human" | "agent"
): Promise<string | null> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isInputClosed(process.stdin)) {
      cancel("Cancelled.");
      return null;
    }

    const value = await text({
      message,
      placeholder: "e.g. 012345...abcdef",
    });
    if (isCancel(value)) {
      cancel("Cancelled.");
      return null;
    }
    if (value === undefined && isInputClosed(process.stdin)) {
      cancel("Cancelled.");
      return null;
    }

    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length > 0) {
      if (isValidSpaceId(normalized)) {
        return normalized;
      }
      process.stderr.write(
        `${formatMessage(resolvedView, "space.target.invalid", {
          space: normalized,
        })}\n`
      );
      continue;
    }

    process.stderr.write("Space ID is required.\n");
  }

  cancel("Cancelled.");
  return null;
}
