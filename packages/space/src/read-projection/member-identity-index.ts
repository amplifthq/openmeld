import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";

export type SpaceMemberIdentityEntry = {
  profileId: string;
  profileKind: "human" | "agent" | "system" | null;
  profileName: string;
  source: "identity_directory" | "member_snapshot" | "signal_history";
};

export type SpaceMemberIdentityIndex = {
  byProfileId: ReadonlyMap<string, SpaceMemberIdentityEntry>;
};

export function createSpaceMemberIdentityIndex(input: {
  identityDirectory?: SpaceIdentityDirectory | null;
  snapshot?: SpaceMembersSnapshot | null;
  signals?: Iterable<SignalEnvelope> | null;
}): SpaceMemberIdentityIndex {
  const byProfileId = new Map<string, SpaceMemberIdentityEntry>();

  for (const signal of input.signals ?? []) {
    registerSignalIdentity(byProfileId, signal);
  }

  for (const entry of input.identityDirectory?.entries ?? []) {
    registerAuthoritativeIdentityEntry(byProfileId, {
      profileId: entry.profileId,
      profileKind: normalizeProfileKind(entry.profileKind),
      profileName: entry.profileName,
      source: "identity_directory",
    });
  }

  for (const member of [
    ...(input.snapshot?.humans ?? []),
    ...(input.snapshot?.agents ?? []),
  ]) {
    registerAuthoritativeIdentityEntry(byProfileId, {
      profileId: member.profileId,
      profileKind: normalizeProfileKind(member.profileKind),
      profileName: member.profileName,
      source: "member_snapshot",
    });
  }

  return { byProfileId };
}

function registerAuthoritativeIdentityEntry(
  byProfileId: Map<string, SpaceMemberIdentityEntry>,
  input: {
    profileId: string;
    profileKind: "human" | "agent" | "system" | null;
    profileName: string;
    source: "identity_directory" | "member_snapshot";
  }
): void {
  const existingEntry = byProfileId.get(input.profileId);
  if (
    existingEntry?.source === "identity_directory" ||
    existingEntry?.source === "member_snapshot"
  ) {
    throw new Error(
      `Invariant violation: duplicate profile id "${input.profileId}" in space member identity index.`
    );
  }

  byProfileId.set(input.profileId, input);
}

function registerSignalIdentity(
  byProfileId: Map<string, SpaceMemberIdentityEntry>,
  signal: SignalEnvelope
): void {
  registerIdentityEntry(byProfileId, {
    profileId: normalizeOptionalText(signal.profile?.profileId),
    profileKind: normalizeProfileKind(signal.profile?.kind),
    profileName: normalizeOptionalText(signal.profile?.profileName),
  });

  if (signal.type !== "signal.text") {
    return;
  }

  const targetProfileId = normalizeOptionalText(
    signal.data.meta?.targetProfileId
  );
  const targetProfileName = normalizeOptionalText(
    signal.data.meta?.targetProfileName
  );
  if (!(targetProfileId && targetProfileName)) {
    return;
  }

  registerIdentityEntry(byProfileId, {
    profileId: targetProfileId,
    profileKind: normalizeProfileKind(signal.data.meta?.targetProfileKind),
    profileName: targetProfileName,
  });
}

function registerIdentityEntry(
  byProfileId: Map<string, SpaceMemberIdentityEntry>,
  input: {
    profileId: string | null;
    profileKind: "human" | "agent" | "system" | null;
    profileName: string | null;
  }
): void {
  if (!(input.profileId && input.profileName)) {
    return;
  }

  const existingEntry = byProfileId.get(input.profileId);
  if (
    existingEntry?.source === "identity_directory" ||
    existingEntry?.source === "member_snapshot"
  ) {
    return;
  }

  byProfileId.set(input.profileId, {
    profileId: input.profileId,
    profileKind: input.profileKind,
    profileName: input.profileName,
    source: "signal_history",
  });
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeProfileKind(
  value: string | null | undefined
): "human" | "agent" | "system" | null {
  return value === "human" || value === "agent" || value === "system"
    ? value
    : null;
}
