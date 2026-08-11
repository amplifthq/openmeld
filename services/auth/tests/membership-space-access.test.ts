import { describe, expect, it, vi } from "vitest";
import { listMembershipSpaceIdsForProfiles } from "../src/lib/profiles/membership-space-access";

type CoreWorkerArg = Parameters<
  typeof listMembershipSpaceIdsForProfiles
>[0]["coreWorker"];

function createCoreWorker(result: string[]) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    coreWorker: {
      listMembershipSpaceIdsForProfiles: rpc,
    } as unknown as CoreWorkerArg,
    rpc,
  };
}

describe("listMembershipSpaceIdsForProfiles (reads core's projection via RPC)", () => {
  it("forwards the candidates to the core RPC and returns its space ids", async () => {
    const { coreWorker, rpc } = createCoreWorker(["a".repeat(64)]);

    const spaceIds = await listMembershipSpaceIdsForProfiles({
      coreWorker,
      profileIds: ["agt_1", "hum_1"],
      spaceIds: ["a".repeat(64), "b".repeat(64)],
    });

    expect(spaceIds).toEqual(["a".repeat(64)]);
    expect(rpc).toHaveBeenCalledWith({
      profileIds: ["agt_1", "hum_1"],
      spaceIds: ["a".repeat(64), "b".repeat(64)],
    });
  });

  it("short-circuits without calling the RPC when either side is empty", async () => {
    const { coreWorker, rpc } = createCoreWorker([]);

    await expect(
      listMembershipSpaceIdsForProfiles({
        coreWorker,
        profileIds: [],
        spaceIds: ["a".repeat(64)],
      })
    ).resolves.toEqual([]);
    await expect(
      listMembershipSpaceIdsForProfiles({
        coreWorker,
        profileIds: ["agt_1"],
        spaceIds: [],
      })
    ).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws when the core worker binding is missing (caller falls back to history-only)", async () => {
    await expect(
      listMembershipSpaceIdsForProfiles({
        coreWorker: undefined,
        profileIds: ["agt_1"],
        spaceIds: ["a".repeat(64)],
      })
    ).rejects.toThrow("OPENMELD_CORE_WORKER");
  });
});
