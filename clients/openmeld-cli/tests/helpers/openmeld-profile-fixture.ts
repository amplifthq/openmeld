import { buildProfileHandleBase } from "@openmeld/protocol";
import type {
  OpenMeldProfile,
  OpenMeldProfileKind,
  OpenMeldProfileStatus,
} from "../../src/config/openmeld-profiles-api";

type CreateTestOpenMeldProfileInput = {
  openMeldProfileId: string;
  profileName: string;
  profileHandle?: string;
  profileKind?: OpenMeldProfileKind;
  status?: OpenMeldProfileStatus;
  ownerUserId?: string;
  ownerName?: string;
  source?: string;
  createdByUserId?: string | null;
  lastUsedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  isDefault?: boolean;
};

export function createTestProfileHandle(
  profileName: string,
  profileKind: OpenMeldProfileKind = "agent"
): string {
  return buildProfileHandleBase({
    profileName,
    profileKind,
  });
}

export function createTestOpenMeldProfile(
  input: CreateTestOpenMeldProfileInput
): OpenMeldProfile {
  const profileKind = input.profileKind ?? "agent";

  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileHandle:
      input.profileHandle ??
      createTestProfileHandle(input.profileName, profileKind),
    profileKind,
    status: input.status ?? "active",
    ownerUserId: input.ownerUserId ?? "user-1",
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    source: input.source ?? "cli_create",
    createdByUserId: input.createdByUserId ?? "user-1",
    lastUsedAt: input.lastUsedAt ?? null,
    createdAt: input.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-03-01T00:00:00.000Z",
    ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
  };
}
