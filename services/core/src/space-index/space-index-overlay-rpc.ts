import { type CoreBindings, projectionsDb } from "../lib/bindings";
import { resolveSpaceStub } from "../rpc/space-ref";
import {
  type WriteSpaceIndexMembershipOverlayInput,
  writeSpaceIndexMembershipOverlay,
} from "./space-index-repository";

export type ProjectSpaceIndexMembershipOverlayRpcInput = {
  spaceId: string;
  profileId: string;
  gatewayHost: string;
  active: boolean;
  pinnedAtMs: number | null;
  lastJoinedAtMs: number | null;
  lastSeenTs: number | null;
  updatedAtMs: number | null;
};

export type ProjectSpaceIndexMembershipOverlayRpcResult = {
  repairAttempted: boolean;
  status: "applied" | "degraded" | "pending";
  updated: boolean;
};

// Auth-worker entry for the Space Index overlay projection
// (physical-db-split.md P0.3): the Profile domain announces a history change,
// Core projects it onto the membership row, and repairs a missing membership
// projection from Space truth before returning the overlay status.
export async function rpcProjectSpaceIndexMembershipOverlay(
  env: CoreBindings,
  input: ProjectSpaceIndexMembershipOverlayRpcInput
): Promise<ProjectSpaceIndexMembershipOverlayRpcResult> {
  const db = projectionsDb(env);
  if (!db) {
    throw new Error(
      "space index overlay projection requires the OPENMELD_DB binding"
    );
  }
  const normalized: WriteSpaceIndexMembershipOverlayInput = {
    db,
    spaceId: requireText(input.spaceId, "spaceId"),
    profileId: requireText(input.profileId, "profileId"),
    gatewayHost: requireText(input.gatewayHost, "gatewayHost").toLowerCase(),
    active: input.active === true,
    pinnedAtMs: optionalNonNegativeInteger(input.pinnedAtMs, "pinnedAtMs"),
    lastJoinedAtMs: optionalNonNegativeInteger(
      input.lastJoinedAtMs,
      "lastJoinedAtMs"
    ),
    lastSeenTs: optionalNonNegativeInteger(input.lastSeenTs, "lastSeenTs"),
    updatedAtMs: optionalNonNegativeInteger(input.updatedAtMs, "updatedAtMs"),
  };
  const result = await writeSpaceIndexMembershipOverlay(normalized);
  if (result.updated) {
    return { repairAttempted: false, status: "applied", updated: true };
  }

  logOverlayWriteMiss(normalized, "initial");
  const repair = await reprojectSpaceIndexFromSpaceTruth(
    env,
    normalized.spaceId
  );
  if (!repair.projected) {
    return { repairAttempted: true, status: "degraded", updated: false };
  }

  const retry = await writeSpaceIndexMembershipOverlay(normalized);
  if (retry.updated) {
    return { repairAttempted: true, status: "applied", updated: true };
  }

  logOverlayWriteMiss(normalized, "after_reproject");
  return { repairAttempted: true, status: "pending", updated: false };
}

function logOverlayWriteMiss(
  input: WriteSpaceIndexMembershipOverlayInput,
  phase: "after_reproject" | "initial"
): void {
  // Projection lag: the membership row does not exist yet (history write raced
  // ahead of the Space-domain membership projection). Make the drift visible and
  // auditable; the caller repairs from Space truth before retrying.
  console.warn({
    event: "core.space_index_overlay.write_miss",
    profileId: input.profileId,
    spaceId: input.spaceId,
    gatewayHost: input.gatewayHost,
    active: input.active,
    phase,
  });
}

async function reprojectSpaceIndexFromSpaceTruth(
  env: CoreBindings,
  spaceId: string
): Promise<{ projected: boolean }> {
  const shard = resolveSpaceStub(env.OPENMELD_SPACES, spaceId);
  if (!shard) {
    console.warn({
      event: "core.space_index_overlay.reproject_invalid_space",
      spaceId,
    });
    return { projected: false };
  }

  try {
    const result = await shard.rpcReprojectSpaceIndexSnapshot({ spaceId });
    if (!result.projected) {
      console.warn({
        event: "core.space_index_overlay.reproject_incomplete",
        spaceId,
        projectionStatus: result.projectionStatus,
      });
    }
    return { projected: result.projected };
  } catch (error) {
    console.warn({
      event: "core.space_index_overlay.reproject_failed",
      message: error instanceof Error ? error.message : String(error),
      spaceId,
    });
    return { projected: false };
  }
}

function requireText(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer or null`);
  }
  return value as number;
}
