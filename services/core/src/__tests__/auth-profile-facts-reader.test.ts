import type { AuthRpcProfileFact } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readAuthProfileFacts } from "../auth/application/profile-facts-reader";
import type { CoreBindings } from "../lib/bindings";

const fact = (profileId: string): AuthRpcProfileFact => ({
  profileId,
  profileName: "Agent",
  profileHandle: "agent",
  profileKind: "agent",
  status: "active",
  ownerUserId: "owner",
});

describe("Auth Profile fact batches", () => {
  it("reads only the requested set, deduplicated and in bounded batches", async () => {
    const profileIds = Array.from({ length: 250 }, (_, i) => `agt_${i}`);
    const resolveProfilesByIds = vi.fn(
      async ({ profileIds: ids }: { profileIds: string[] }) => ({
        ok: true as const,
        profiles: Object.fromEntries(ids.map((id) => [id, fact(id)])),
      })
    );
    const resolveProfileById = vi.fn();
    const profiles = await readAuthProfileFacts({
      authWorker: {
        resolveProfilesByIds,
        resolveProfileById,
      } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"],
      profileIds: [...profileIds, "agt_0"],
    });
    expect(profiles?.size).toBe(250);
    expect(
      resolveProfilesByIds.mock.calls.map(([input]) => input.profileIds.length)
    ).toEqual([64, 64, 64, 58]);
    expect(
      resolveProfilesByIds.mock.calls.flatMap(([input]) => input.profileIds)
    ).toEqual(profileIds);
    expect(resolveProfileById).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, code: "database.overloaded", message: "Unavailable" },
    { ok: true, profiles: {} },
    { ok: true, profiles: { target: fact("different") } },
    { ok: true, profiles: { target: null, unrequested: fact("unrequested") } },
  ])("does not turn unavailable or malformed evidence into a missing Profile: %j", async (response) => {
    const authWorker = {
      resolveProfilesByIds: async () => response,
    } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"];
    expect(
      await readAuthProfileFacts({ authWorker, profileIds: ["target"] })
    ).toBeNull();
  });

  it("preserves explicit absence and disabled identities for the owning policy", async () => {
    const disabled = { ...fact("disabled"), status: "disabled" as const };
    const profiles = await readAuthProfileFacts({
      authWorker: {
        resolveProfilesByIds: async () => ({
          ok: true,
          profiles: { missing: null, disabled },
        }),
      } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"],
      profileIds: ["missing", "disabled"],
    });
    expect(profiles?.has("missing")).toBe(true);
    expect(profiles?.get("missing")).toBeNull();
    expect(profiles?.get("disabled")).toEqual(disabled);
  });

  it("discards a partial catalog if a later batch fails", async () => {
    const resolveProfilesByIds = vi
      .fn()
      .mockImplementationOnce(
        async ({ profileIds }: { profileIds: string[] }) => ({
          ok: true,
          profiles: Object.fromEntries(profileIds.map((id) => [id, fact(id)])),
        })
      )
      .mockRejectedValueOnce(new Error("D1 overloaded"));
    expect(
      await readAuthProfileFacts({
        authWorker: {
          resolveProfilesByIds,
        } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"],
        profileIds: Array.from({ length: 65 }, (_, i) => `profile-${i}`),
      })
    ).toBeNull();
  });

  it("does not query Auth for an empty set or launch another batch after its display deadline", async () => {
    const resolveProfilesByIds = vi.fn();
    const authWorker = {
      resolveProfilesByIds,
    } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"];
    expect(
      (await readAuthProfileFacts({ authWorker, profileIds: [] }))?.size
    ).toBe(0);
    expect(
      await readAuthProfileFacts({
        authWorker,
        profileIds: ["target"],
        deadlineAtMs: Date.now() - 1,
      })
    ).toBeNull();
    expect(resolveProfilesByIds).not.toHaveBeenCalled();
  });
});
