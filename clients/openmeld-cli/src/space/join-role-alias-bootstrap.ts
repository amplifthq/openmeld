import { cancel, isCancel, text } from "@clack/prompts";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { createPresenter } from "../runtime/presenter/index";
import {
  normalizeRoleValue,
  normalizeStoredMentionAliasValue,
  resolveSessionMentionAlias,
  resolveSessionRoleContext,
} from "./connect-session-meta";
import type { SpaceConfig } from "./local-state";

const MENTION_ALIAS_TOKEN_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type JoinRoleAliasBootstrapPresenter = Pick<
  ReturnType<typeof createPresenter>,
  "event"
>;

type JoinBootstrapSource = "explicit" | "cloud" | "local" | "none";

type SpaceJoinCursorBootstrap = {
  role?: string;
  mentionAlias?: string;
};

export type SpaceJoinRoleAliasBootstrapResult =
  | {
      status: "ready";
      role?: string;
      mentionAlias?: string;
      roleSource: JoinBootstrapSource;
      mentionAliasSource: JoinBootstrapSource;
      usedCursorBootstrap: boolean;
    }
  | { status: "cancelled" };

export type SpaceJoinRoleAliasBootstrapDependencies = {
  fetchSpaceCursorForBootstrap(input: {
    openMeldProfile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    password?: string;
  }): Promise<SpaceJoinCursorBootstrap>;
};

// Join role/alias bootstrap owns join-side cursor-backed precedence,
// first-local-join role prompting, and bootstrap summary emission only.
export async function resolveSpaceJoinRoleAliasBootstrap(
  input: {
    openMeldProfile: OpenMeldProfile;
    openMeldProfileId: string;
    baseUrl: string;
    space: string;
    password?: string;
    existingSpaceConfig: SpaceConfig | null;
    roleInput?: string;
    mentionAliasInput?: string;
    resolvedView: "human" | "agent";
    allowPromptRoleContext: boolean;
    presenter: JoinRoleAliasBootstrapPresenter;
  },
  dependencies: SpaceJoinRoleAliasBootstrapDependencies
): Promise<SpaceJoinRoleAliasBootstrapResult> {
  const explicitRole = normalizeRoleValue(input.roleInput);
  const explicitMentionAliasInputProvided =
    typeof input.mentionAliasInput === "string";
  const explicitMentionAlias = normalizeJoinMentionAliasInput(
    input.mentionAliasInput
  );
  if (explicitMentionAliasInputProvided && !explicitMentionAlias) {
    throw new Error(
      "invalid --mention-alias: use letters/numbers with optional . _ - (max 128 chars)"
    );
  }

  const localRole = normalizeRoleValue(input.existingSpaceConfig?.role);
  const localMentionAlias = normalizeStoredMentionAliasValue({
    mentionAlias: input.existingSpaceConfig?.mentionAlias,
    profileId: input.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    profileKind: input.openMeldProfile.profileKind,
  });

  const cursorBootstrap = await dependencies
    .fetchSpaceCursorForBootstrap({
      openMeldProfile: input.openMeldProfile,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
    })
    .catch(() => null);
  const cloudRole = normalizeRoleValue(cursorBootstrap?.role);
  const cloudMentionAlias = normalizeStoredMentionAliasValue({
    mentionAlias: cursorBootstrap?.mentionAlias,
    profileId: input.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    profileKind: input.openMeldProfile.profileKind,
  });

  let roleContext = resolveSessionRoleContext({
    inputRole: explicitRole,
    cloudRole,
    localRole,
  });
  let roleSource = resolveFieldBootstrapSource({
    explicitValue: explicitRole,
    cloudValue: cloudRole,
    localValue: localRole,
  });
  if (
    input.resolvedView === "human" &&
    input.allowPromptRoleContext &&
    input.existingSpaceConfig === null
  ) {
    const promptedRole = await resolvePromptedOptionalRoleField({
      currentValue: roleContext.role,
      message: "Role",
      placeholder:
        "e.g. Responsible for final architecture direction and design reviews.",
    });
    if (promptedRole === null) {
      return { status: "cancelled" };
    }

    roleContext = {
      ...(promptedRole ? { role: promptedRole } : {}),
    };
    roleSource = resolvePromptedFieldBootstrapSource({
      currentSource: roleSource,
      value: promptedRole,
    });
  }

  const mentionAlias = resolveSessionMentionAlias({
    inputMentionAlias: explicitMentionAlias,
    cloudMentionAlias,
    localMentionAlias,
    profileId: input.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    profileKind: input.openMeldProfile.profileKind,
  });
  const mentionAliasSource = resolveMentionAliasBootstrapSource({
    explicitMentionAliasInputProvided,
    explicitMentionAlias,
    cloudMentionAlias,
    localMentionAlias,
  });
  const usedCursorBootstrap =
    roleSource === "cloud" || mentionAliasSource === "cloud";

  emitJoinBootstrapContext({
    presenter: input.presenter,
    role: roleContext.role,
    mentionAlias,
    roleSource,
    mentionAliasSource,
    usedCursorBootstrap,
  });

  return {
    status: "ready",
    ...(roleContext.role ? { role: roleContext.role } : {}),
    ...(mentionAlias ? { mentionAlias } : {}),
    roleSource,
    mentionAliasSource,
    usedCursorBootstrap,
  };
}

function resolveFieldBootstrapSource(input: {
  explicitValue?: string;
  cloudValue?: string;
  localValue?: string;
}): JoinBootstrapSource {
  if (input.explicitValue) {
    return "explicit";
  }
  if (input.cloudValue) {
    return "cloud";
  }
  if (input.localValue) {
    return "local";
  }
  return "none";
}

function resolvePromptedFieldBootstrapSource(input: {
  currentSource: JoinBootstrapSource;
  value?: string;
}): JoinBootstrapSource {
  if (input.currentSource !== "none") {
    return input.currentSource;
  }
  if (input.value) {
    return "explicit";
  }
  return "none";
}

function resolveMentionAliasBootstrapSource(input: {
  explicitMentionAliasInputProvided: boolean;
  explicitMentionAlias?: string;
  cloudMentionAlias?: string;
  localMentionAlias?: string;
}): JoinBootstrapSource {
  if (input.explicitMentionAliasInputProvided) {
    return input.explicitMentionAlias ? "explicit" : "none";
  }
  if (input.cloudMentionAlias) {
    return "cloud";
  }
  if (input.localMentionAlias) {
    return "local";
  }
  return "none";
}

function normalizeJoinMentionAliasInput(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !MENTION_ALIAS_TOKEN_REGEX.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

async function resolvePromptedOptionalRoleField(input: {
  currentValue?: string;
  message: string;
  placeholder: string;
}): Promise<string | undefined | null> {
  if (input.currentValue) {
    return input.currentValue;
  }

  const value = await text({
    message: `${input.message} (optional)`,
    placeholder: input.placeholder,
  });
  if (isCancel(value)) {
    cancel("Cancelled.");
    return null;
  }

  return normalizeRoleValue(typeof value === "string" ? value : undefined);
}

function emitJoinBootstrapContext(input: {
  presenter: JoinRoleAliasBootstrapPresenter;
  role?: string;
  mentionAlias?: string;
  roleSource: JoinBootstrapSource;
  mentionAliasSource: JoinBootstrapSource;
  usedCursorBootstrap: boolean;
}): void {
  if (!(input.role || input.mentionAlias)) {
    return;
  }

  input.presenter.event("info", "space.join.bootstrap_context", {
    ...(input.role ? { role: input.role } : {}),
    ...(input.mentionAlias ? { mentionAlias: input.mentionAlias } : {}),
    roleSource: input.roleSource,
    mentionAliasSource: input.mentionAliasSource,
    usedCursorBootstrap: input.usedCursorBootstrap,
  });
}
