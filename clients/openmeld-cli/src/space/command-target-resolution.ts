import type { SpaceMeta } from "@openmeld/protocol";
import { listAccountSpaceIndex } from "../config/account-space-index-api";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import {
  createSpaceSubcommandTargetGuideError,
  createSpaceTargetGuideError,
} from "../runtime/dual-view-guide-catalog";
import { formatMessage } from "../runtime/messages";
import type { createPresenter } from "../runtime/presenter/index";
import { createDelayedSpinner } from "../ui/delayed-spinner";
import { assertValidSpaceIdTarget } from "./command-context";
import { normalizeOptionalString } from "./command-http-errors";
import {
  filterKnownSpacesForSelection,
  type KnownSpaceDeletedNotice,
  type KnownSpaceOption,
  type KnownSpaceVisibilityScope,
  resolveKnownSpaceVisibilityScope,
  shouldLoadCloudKnownSpaces,
  sortKnownSpacesForSelection,
  toKnownSpaceOptionFromAccountIndex,
  toKnownSpaceOptionFromLocal,
} from "./command-known-space-projection";
import {
  maybeEmitKnownSpaceDeletedNotices,
  promptSpaceDeleteSelection,
  promptSpaceSelectionTarget,
  type SpaceDeleteTarget,
  type SpaceDeleteTargetSelectionResult,
  toSpaceDeleteTarget,
} from "./command-selection-prompts";
import {
  LocalSpaceStateIntegrityError,
  listSpaceConfigs,
  type SpaceConfig,
  toSpaceConfigListIntegrityError,
} from "./local-state";
import { fetchSpaceMeta } from "./meta-api";

export const SPACE_LOADING_SPINNER_MESSAGE = "Loading spaces...";

export function requireReadableSpaceConfigList(
  result: Awaited<ReturnType<typeof listSpaceConfigs>>,
  operation: string
): SpaceConfig[] {
  if (result.kind === "corrupt") {
    throw toSpaceConfigListIntegrityError({
      operation,
      result,
    });
  }
  return result.items;
}

export type KnownSpaceSelectionResult = {
  items: KnownSpaceOption[];
  visibilityScope: KnownSpaceVisibilityScope;
  deletedNotices: KnownSpaceDeletedNotice[];
};

export function filterKnownSpacesCreatedByProfile(input: {
  known: KnownSpaceOption[];
  profileId: string;
}): KnownSpaceOption[] {
  const profileId = normalizeOptionalString(input.profileId);
  if (!profileId) {
    return [];
  }
  return input.known.filter((item) => {
    const creatorProfileId =
      typeof item.creatorProfileId === "string"
        ? normalizeOptionalString(item.creatorProfileId)
        : null;
    return creatorProfileId === profileId;
  });
}

async function resolveOwnedKnownSpacesForDelete(input: {
  known: KnownSpaceOption[];
  openMeldProfile: OpenMeldProfile;
  openMeldProfileId: string;
  profileName: string;
  ownerUserId?: string;
  baseUrl: string;
}): Promise<KnownSpaceOption[]> {
  const currentProfileId = normalizeOptionalString(input.openMeldProfileId);
  const currentOwnerUserId = normalizeOptionalString(input.ownerUserId);
  if (!currentProfileId) {
    return [];
  }

  const owned: KnownSpaceOption[] = [];
  for (const candidate of input.known) {
    const initialOwnership = classifyKnownSpaceOwnershipForDelete({
      item: candidate,
      currentProfileId,
      currentOwnerUserId,
    });
    if (initialOwnership === "foreign") {
      continue;
    }

    const shouldHydrate =
      initialOwnership === "unknown" ||
      shouldHydrateCreatorProfileNameForDelete({
        item: candidate,
        currentProfileId,
      });
    const hydrated = shouldHydrate
      ? await hydrateKnownSpaceForDeleteFromMeta({
          item: candidate,
          openMeldProfile: input.openMeldProfile,
          baseUrl: input.baseUrl,
        })
      : candidate;
    const finalOwnership = classifyKnownSpaceOwnershipForDelete({
      item: hydrated,
      currentProfileId,
      currentOwnerUserId,
    });
    if (finalOwnership !== "owned") {
      continue;
    }
    owned.push(
      applyKnownSpaceDeleteCreatorFallback({
        item: hydrated,
        currentProfileId,
        currentProfileName: input.profileName,
        currentOwnerUserId,
      })
    );
  }
  return owned;
}

async function resolveExplicitSpaceDeleteTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
}): Promise<SpaceDeleteTarget> {
  const matchedKnown = await findKnownSpaceForDeleteBySpaceId({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    space: input.space,
  });
  if (matchedKnown) {
    return toSpaceDeleteTarget(matchedKnown);
  }

  const localKnown = requireReadableSpaceConfigList(
    await listSpaceConfigs({
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    }),
    "listing known local spaces for explicit delete target resolution"
  );
  const matchedLocal = localKnown.find((item) => item.space === input.space);
  if (matchedLocal) {
    return toSpaceDeleteTarget(
      toKnownSpaceOptionFromLocal(matchedLocal, input.openMeldProfile)
    );
  }
  const candidate = {
    source: "local" as const,
    space: input.space,
    baseUrl: input.baseUrl,
  };
  const hydrated = await hydrateKnownSpaceForDeleteFromMeta({
    item: candidate,
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
  });
  return toSpaceDeleteTarget(hydrated);
}

async function findKnownSpaceForDeleteBySpaceId(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
}): Promise<KnownSpaceOption | null> {
  const knownResult = await resolveKnownSpacesForSelection({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "delete",
  }).catch((error) => {
    if (error instanceof LocalSpaceStateIntegrityError) {
      throw error;
    }
    return null;
  });
  const matched = knownResult?.items.find((item) => item.space === input.space);
  if (!matched) {
    return null;
  }

  const [authorized] = await resolveOwnedKnownSpacesForDelete({
    known: [matched],
    openMeldProfile: input.openMeldProfile,
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    ownerUserId: input.openMeldProfile.ownerUserId,
    baseUrl: input.baseUrl,
  });
  if (authorized) {
    return authorized;
  }

  return await hydrateKnownSpaceForDeleteFromMeta({
    item: matched,
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
  });
}

type DeleteOwnership = "owned" | "foreign" | "unknown";

function classifyKnownSpaceOwnershipForDelete(input: {
  item: KnownSpaceOption;
  currentProfileId: string;
  currentOwnerUserId: string | null;
}): DeleteOwnership {
  const creatorKind = resolveMetaCreatorKind(input.item.creatorKind);
  const creatorProfileId = normalizeOptionalString(input.item.creatorProfileId);
  if (!creatorKind) {
    return "unknown";
  }
  if (creatorKind === "system") {
    return "foreign";
  }
  if (creatorKind === "human") {
    if (!creatorProfileId) {
      return "unknown";
    }
    return creatorProfileId === input.currentProfileId ? "owned" : "foreign";
  }
  const creatorOwnerUserId = normalizeOptionalString(
    input.item.creatorOwnerUserId
  );
  if (!(creatorOwnerUserId && input.currentOwnerUserId)) {
    return "unknown";
  }
  return creatorOwnerUserId === input.currentOwnerUserId ? "owned" : "foreign";
}

function shouldHydrateCreatorProfileNameForDelete(input: {
  item: KnownSpaceOption;
  currentProfileId: string;
}): boolean {
  if (normalizeOptionalString(input.item.creatorProfileName)) {
    return false;
  }
  const creatorKind = resolveMetaCreatorKind(input.item.creatorKind);
  const creatorProfileId = normalizeOptionalString(input.item.creatorProfileId);
  if (creatorKind === "human" && creatorProfileId === input.currentProfileId) {
    return false;
  }
  return true;
}

async function hydrateKnownSpaceForDeleteFromMeta(input: {
  item: KnownSpaceOption;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
}): Promise<KnownSpaceOption> {
  const targetBaseUrl = input.item.baseUrl ?? input.baseUrl;
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.openMeldProfile,
  });
  try {
    const meta = await fetchSpaceMeta({
      requestContext,
      baseUrl: targetBaseUrl,
      space: input.item.space,
    });
    const creatorProfileId = resolveMetaCreatorProfileId(meta.creator);
    const creatorProfileName = resolveMetaCreatorProfileName(meta.creator);
    const creatorOwnerUserId = resolveMetaCreatorOwnerUserId(meta.creator);
    const creatorKind = resolveMetaCreatorKind(meta.creator?.kind);
    const spaceName =
      typeof meta.name === "string" ? normalizeOptionalString(meta.name) : null;
    const spaceCreatedAt =
      typeof meta.createdAt === "string"
        ? normalizeOptionalString(meta.createdAt)
        : null;
    const spaceUpdatedAt =
      typeof meta.updatedAt === "string"
        ? normalizeOptionalString(meta.updatedAt)
        : null;
    return {
      ...input.item,
      ...(spaceName === null ? {} : { name: spaceName }),
      ...(creatorProfileName === null ? {} : { creatorProfileName }),
      ...(creatorProfileId === null ? {} : { creatorProfileId }),
      ...(creatorOwnerUserId === null ? {} : { creatorOwnerUserId }),
      ...(creatorKind === null ? {} : { creatorKind }),
      ...(spaceCreatedAt === null ? {} : { spaceCreatedAt }),
      ...(spaceUpdatedAt === null ? {} : { spaceUpdatedAt }),
    };
  } catch {
    return input.item;
  }
}

function applyKnownSpaceDeleteCreatorFallback(input: {
  item: KnownSpaceOption;
  currentProfileId: string;
  currentProfileName: string;
  currentOwnerUserId: string | null;
}): KnownSpaceOption {
  const creatorProfileName = normalizeOptionalString(
    input.item.creatorProfileName
  );
  const creatorOwnerUserId = normalizeOptionalString(
    input.item.creatorOwnerUserId
  );
  const creatorProfileId = normalizeOptionalString(input.item.creatorProfileId);

  const nextCreatorProfileName =
    creatorProfileName ??
    (creatorProfileId === input.currentProfileId
      ? normalizeOptionalString(input.currentProfileName)
      : null);
  const nextCreatorOwnerUserId =
    creatorOwnerUserId ?? normalizeOptionalString(input.currentOwnerUserId);

  if (
    nextCreatorProfileName === creatorProfileName &&
    nextCreatorOwnerUserId === creatorOwnerUserId
  ) {
    return input.item;
  }

  return {
    ...input.item,
    ...(nextCreatorProfileName
      ? { creatorProfileName: nextCreatorProfileName }
      : {}),
    ...(nextCreatorOwnerUserId
      ? { creatorOwnerUserId: nextCreatorOwnerUserId }
      : {}),
  };
}

export async function resolveSpaceTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space?: string;
  command: "join" | "watch" | "guide" | "delete" | "password";
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<{ space: string; baseUrl?: string } | null> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    const known = requireReadableSpaceConfigList(
      await listSpaceConfigs({
        openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      }),
      "listing known local spaces for explicit target resolution"
    );
    const matched = known.find((item) => item.space === explicitSpace);
    return {
      space: explicitSpace,
      ...(matched?.baseUrl ? { baseUrl: matched.baseUrl } : {}),
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      if (input.command === "password") {
        throw createSpaceSubcommandTargetGuideError("password");
      }
      throw createSpaceTargetGuideError(input.command);
    }
    throw new Error(
      formatMessage(input.resolvedView, "space.target.missing", {
        command: input.command,
      })
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: input.command,
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  const inlineDeletedNotices =
    input.resolvedView === "human" && known.items.length > 0
      ? known.deletedNotices
      : [];
  if (inlineDeletedNotices.length === 0) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: known.deletedNotices,
    });
  }
  const target = await promptSpaceSelectionTarget({
    known: known.items,
    command: input.command,
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: known.visibilityScope,
    deletedNotices: inlineDeletedNotices,
  });
  return target.status === "submitted" ? target.target : null;
}

export async function resolveSpaceDeleteTargets(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space?: string;
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowBack?: boolean;
}): Promise<SpaceDeleteTargetSelectionResult> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    return {
      status: "submitted",
      allowBackToSelection: false,
      targets: [
        await resolveExplicitSpaceDeleteTarget({
          openMeldProfile: input.openMeldProfile,
          baseUrl: input.baseUrl,
          space: explicitSpace,
        }),
      ],
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceTargetGuideError("delete");
    }
    throw new Error(
      formatMessage(input.resolvedView, "space.target.missing", {
        command: "delete",
      })
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "delete",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  await maybeEmitKnownSpaceDeletedNotices({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    deletedNotices: known.deletedNotices,
  });
  const ownedKnownSpaces = await resolveOwnedKnownSpacesForDelete({
    known: known.items,
    openMeldProfile: input.openMeldProfile,
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    ownerUserId: input.openMeldProfile.ownerUserId,
    baseUrl: input.baseUrl,
  });
  return promptSpaceDeleteSelection({
    known: ownedKnownSpaces,
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    allowBack: input.allowBack === true,
  });
}

async function resolveKnownSpacesForSelection(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
}): Promise<KnownSpaceSelectionResult> {
  const visibilityScope = resolveKnownSpaceVisibilityScope({
    openMeldProfile: input.openMeldProfile,
    command: input.command,
  });
  if (
    !shouldLoadCloudKnownSpaces({
      command: input.command,
      visibilityScope,
    })
  ) {
    return {
      items: await listLocalKnownSpacesForSelection(input.openMeldProfile),
      visibilityScope,
      deletedNotices: [],
    };
  }

  const scope = visibilityScope === "owner" ? "account" : "profile";
  let index: Awaited<ReturnType<typeof listAccountSpaceIndex>>;
  try {
    index = await listAccountSpaceIndex({
      baseUrl: input.baseUrl,
      requestContext: buildOpenMeldRequestContextFromProfile({
        openMeldProfile: input.openMeldProfile,
      }),
      includePurposes: true,
      limit: 500,
      scope,
      selectedProfileId: input.openMeldProfile.openMeldProfileId,
    });
  } catch (error) {
    if (!canFallbackToLocalKnownSpaces(error)) {
      throw error;
    }
    return {
      items: await listLocalKnownSpacesForSelection(input.openMeldProfile),
      visibilityScope,
      deletedNotices: [],
    };
  }

  return {
    items: sortKnownSpacesForSelection(
      filterKnownSpacesForSelection(
        [...index.pinnedItems, ...index.spaceItems].map((item) =>
          toKnownSpaceOptionFromAccountIndex(item, input.baseUrl)
        )
      )
    ),
    visibilityScope,
    deletedNotices: [],
  };
}

async function listLocalKnownSpacesForSelection(
  openMeldProfile: OpenMeldProfile
): Promise<KnownSpaceOption[]> {
  const localKnown = requireReadableSpaceConfigList(
    await listSpaceConfigs({
      openMeldProfileId: openMeldProfile.openMeldProfileId,
    }),
    `listing known local spaces for profile ${openMeldProfile.openMeldProfileId}`
  );
  return sortKnownSpacesForSelection(
    filterKnownSpacesForSelection(
      localKnown.map((item) =>
        toKnownSpaceOptionFromLocal(item, openMeldProfile)
      )
    )
  );
}

function canFallbackToLocalKnownSpaces(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error && typeof error === "object")) {
    return false;
  }
  const explicitFallback = (error as { canFallbackToLocal?: unknown })
    .canFallbackToLocal;
  if (explicitFallback === true) {
    return true;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}

export async function resolveKnownSpacesForSelectionWithLoading(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  command:
    | "join"
    | "watch"
    | "guide"
    | "delete"
    | "password"
    | "add_members"
    | "remove_members"
    | "leave";
  showLoading: boolean;
}): Promise<KnownSpaceSelectionResult> {
  const loadingSpinner = createDelayedSpinner({
    enabled: input.showLoading,
    message: SPACE_LOADING_SPINNER_MESSAGE,
  });
  loadingSpinner.start();

  try {
    const result = await resolveKnownSpacesForSelection({
      openMeldProfile: input.openMeldProfile,
      baseUrl: input.baseUrl,
      command: input.command,
    });
    loadingSpinner.complete();
    return result;
  } catch (error) {
    loadingSpinner.fail();
    throw error;
  }
}

export function normalizeMetaForHistory(meta: SpaceMeta): {
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: "human" | "agent" | "system" | null;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
} | null {
  const creatorProfileId = resolveMetaCreatorProfileId(meta.creator);
  const creatorKind = resolveMetaCreatorKind(meta.creator?.kind);
  const spaceName =
    typeof meta.name === "string" ? normalizeOptionalString(meta.name) : null;
  const spaceCreatedAt =
    typeof meta.createdAt === "string"
      ? normalizeOptionalString(meta.createdAt)
      : null;
  const spaceUpdatedAt =
    typeof meta.updatedAt === "string"
      ? normalizeOptionalString(meta.updatedAt)
      : null;

  const hasData =
    spaceName !== null ||
    creatorProfileId !== null ||
    creatorKind !== null ||
    spaceCreatedAt !== null ||
    spaceUpdatedAt !== null;
  if (!hasData) {
    return null;
  }

  return {
    ...(spaceName === null ? {} : { spaceName }),
    ...(creatorProfileId === null ? {} : { creatorProfileId }),
    ...(creatorKind === null ? {} : { creatorKind }),
    ...(spaceCreatedAt === null ? {} : { spaceCreatedAt }),
    ...(spaceUpdatedAt === null ? {} : { spaceUpdatedAt }),
  };
}

function resolveMetaCreatorProfileId(
  creator: SpaceMeta["creator"]
): string | null {
  if (!creator || typeof creator !== "object") {
    return null;
  }
  if (typeof creator.profileId === "string") {
    return normalizeOptionalString(creator.profileId);
  }
  if (typeof creator.profile === "string") {
    return normalizeOptionalString(creator.profile);
  }
  return null;
}

function resolveMetaCreatorProfileName(
  creator: SpaceMeta["creator"]
): string | null {
  if (!creator || typeof creator !== "object") {
    return null;
  }
  if (typeof creator.profileName !== "string") {
    return null;
  }
  return normalizeOptionalString(creator.profileName);
}

function resolveMetaCreatorOwnerUserId(
  creator: SpaceMeta["creator"]
): string | null {
  if (!creator || typeof creator !== "object") {
    return null;
  }
  if (typeof creator.ownerUserId !== "string") {
    return null;
  }
  return normalizeOptionalString(creator.ownerUserId);
}

function resolveMetaCreatorKind(
  kind: unknown
): "human" | "agent" | "system" | null {
  if (kind === "human" || kind === "agent" || kind === "system") {
    return kind;
  }
  return null;
}
