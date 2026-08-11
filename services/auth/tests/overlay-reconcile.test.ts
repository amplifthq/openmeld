import type { ProfileSpaceHistoryRecord } from "@openmeld/auth/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import {
  reconcileSpaceIndexMembershipOverlays,
  type SpaceIndexOverlayProjectionResult,
  toSpaceIndexOverlayProjectionInput,
} from "../src/lib/profiles/overlay-reconcile";

// Reliability proof for the periodic Space Index overlay reconcile
// (physical-db-split.md D7). The per-write hook is fire-and-forget, so this
// bounded sweep is the backstop that converges a dropped/failed Auth→Core
// announcement. These tests pin: (1) the projection payload matches the
// per-write hook's shape, (2) one re-announcement fires per row, (3) a missing
// Core binding is a no-op (never throws), (4) one failing row never sinks the
// rest.

type CoreOverlayWorker = NonNullable<AuthBindings["OPENMELD_CORE_WORKER"]>;

function makeRecord(
  overrides: Partial<ProfileSpaceHistoryRecord> = {}
): ProfileSpaceHistoryRecord {
  return {
    profileId: "human-1",
    gatewayHost: "gateway.openmeld.invalid",
    spaceId: "space-1",
    spaceName: "Space One",
    creatorProfileId: "human-1",
    creatorKind: "human",
    spaceCreatedAt: new Date("2026-06-01T00:00:00.000Z"),
    spaceUpdatedAt: new Date("2026-06-02T00:00:00.000Z"),
    lastJoinedAt: new Date("2026-06-03T00:00:00.000Z"),
    lastSeenTs: 1000,
    pinnedAt: new Date("2026-06-04T00:00:00.000Z"),
    status: "active",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-05T00:00:00.000Z"),
    ...overrides,
  };
}

function makeCoreWorker(
  impl: () => Promise<SpaceIndexOverlayProjectionResult | { updated: boolean }>
): {
  worker: CoreOverlayWorker;
  project: ReturnType<typeof vi.fn>;
} {
  const project = vi.fn(impl);
  return {
    worker: {
      projectSpaceIndexMembershipOverlay: project,
    } as unknown as CoreOverlayWorker,
    project,
  };
}

describe("toSpaceIndexOverlayProjectionInput", () => {
  it("maps history timestamps to the overlay projection ms shape", () => {
    const input = toSpaceIndexOverlayProjectionInput(makeRecord());

    expect(input).toEqual({
      active: true,
      gatewayHost: "gateway.openmeld.invalid",
      lastJoinedAtMs: Date.parse("2026-06-03T00:00:00.000Z"),
      lastSeenTs: 1000,
      pinnedAtMs: Date.parse("2026-06-04T00:00:00.000Z"),
      profileId: "human-1",
      spaceId: "space-1",
      updatedAtMs: Date.parse("2026-06-05T00:00:00.000Z"),
    });
  });

  it("carries a null pinnedAt through as null", () => {
    const input = toSpaceIndexOverlayProjectionInput(
      makeRecord({ pinnedAt: null })
    );

    expect(input.pinnedAtMs).toBeNull();
  });
});

describe("reconcileSpaceIndexMembershipOverlays", () => {
  it("re-announces one overlay projection per row", async () => {
    const { worker, project } = makeCoreWorker(() =>
      Promise.resolve({
        repairAttempted: false,
        status: "applied",
        updated: true,
      })
    );

    const summary = await reconcileSpaceIndexMembershipOverlays({
      coreWorker: worker,
      rows: [
        makeRecord({ spaceId: "space-1" }),
        makeRecord({ spaceId: "space-2" }),
      ],
    });

    expect(project).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ scanned: 2, emitted: 2, skipped: 0 });
  });

  it("is a no-op without a Core binding and never throws", async () => {
    const summary = await reconcileSpaceIndexMembershipOverlays({
      coreWorker: undefined,
      rows: [makeRecord()],
    });

    expect(summary).toEqual({ scanned: 1, emitted: 0, skipped: 1 });
  });

  it("normalizes the pre-status Core overlay result during rolling deploys", async () => {
    const { worker } = makeCoreWorker(() =>
      Promise.resolve({ updated: false })
    );

    const summary = await reconcileSpaceIndexMembershipOverlays({
      coreWorker: worker,
      rows: [makeRecord()],
    });

    expect(summary).toEqual({ scanned: 1, emitted: 1, skipped: 0 });
  });

  it("counts a failing row as skipped without sinking the rest", async () => {
    let call = 0;
    const { worker } = makeCoreWorker(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("core overlay RPC unreachable"))
        : Promise.resolve({
            repairAttempted: false,
            status: "applied",
            updated: true,
          });
    });

    const summary = await reconcileSpaceIndexMembershipOverlays({
      coreWorker: worker,
      rows: [
        makeRecord({ spaceId: "space-1" }),
        makeRecord({ spaceId: "space-2" }),
      ],
    });

    expect(summary).toEqual({ scanned: 2, emitted: 1, skipped: 1 });
  });
});
