import type { SpaceContract } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultSpaceContract,
  DEFAULT_SPACE_CONTRACT_FIELDS,
  handlePatchSpaceContractUseCase,
  handlePutSpaceContractUseCase,
  readOrInitializeSpaceContractUseCase,
} from "../space/application/space-contract-service";

describe("space-contract-service", () => {
  it("builds the canonical default space contract", () => {
    const contract = buildDefaultSpaceContract({
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
    });

    expect(contract).toEqual({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
      ...DEFAULT_SPACE_CONTRACT_FIELDS,
    });
  });

  it("reads and initializes the default contract when absent", () => {
    let current: ReturnType<typeof buildDefaultSpaceContract> | null = null;

    const contract = readOrInitializeSpaceContractUseCase({
      store: {
        readSpaceContract: () => current,
        upsertSpaceContract: (nextContract) => {
          current = nextContract;
        },
      },
      nowIso: "2026-03-19T00:00:00.000Z",
    });

    expect(contract).toEqual({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
      ...DEFAULT_SPACE_CONTRACT_FIELDS,
    });
    expect(current).toEqual(contract);
  });

  it("returns the current contract unchanged when present", () => {
    const existing = {
      version: 3,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "profile-1",
      ...DEFAULT_SPACE_CONTRACT_FIELDS,
      spaceNote: "Keep public updates short.",
    } as const;

    const contract = readOrInitializeSpaceContractUseCase({
      store: {
        readSpaceContract: () => existing,
        upsertSpaceContract: () => {
          throw new Error("should not write when contract already exists");
        },
      },
    });

    expect(contract).toBe(existing);
  });

  it("writes a validated contract and increments version", async () => {
    let current = buildDefaultSpaceContract({
      version: 2,
      updatedAt: "2026-03-18T00:00:00.000Z",
      updatedBy: "profile-1",
    });

    const response = handlePutSpaceContractUseCase({
      body: {
        dispatchPolicy: {
          mode: "mention_only",
        },
        publicationMode: "raw_context_sharing",
        allowedActions: ["post_status", "stay_silent"],
        resultArchivePolicy: {
          mode: "space_reply_only",
        },
        authorityOrder: "default",
        entryBrief: "none",
        dispatchBrief: "default",
      },
      store: {
        readSpaceContract: () => current,
        upsertSpaceContract: (nextContract) => {
          current = nextContract;
        },
      },
      updatedBy: "profile-2",
      nowIso: "2026-03-19T12:00:00.000Z",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 3,
      updatedAt: "2026-03-19T12:00:00.000Z",
      updatedBy: "profile-2",
      dispatchPolicy: {
        mode: "mention_only",
      },
      publicationMode: "raw_context_sharing",
      allowedActions: ["post_status", "stay_silent"],
      resultArchivePolicy: {
        mode: "space_reply_only",
      },
      authorityOrder: "default",
      entryBrief: "none",
      dispatchBrief: "default",
    });
  });

  it("returns the current contract unchanged when a put is a no-op", async () => {
    let current = buildDefaultSpaceContract({
      version: 4,
      updatedAt: "2026-03-18T00:00:00.000Z",
      updatedBy: "profile-1",
    });
    current = {
      ...current,
      spaceNote: "Keep the old note.",
    };
    const upsertSpaceContract = vi.fn();

    const response = handlePutSpaceContractUseCase({
      body: {
        dispatchPolicy: {
          mode: "mention_only",
        },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: {
          mode: "space_reply_only",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      },
      store: {
        readSpaceContract: () => current,
        upsertSpaceContract,
      },
      updatedBy: "profile-2",
      nowIso: "2026-03-20T00:00:00.000Z",
    });

    await expect(response.json()).resolves.toEqual(current);
    expect(upsertSpaceContract).not.toHaveBeenCalled();
  });

  it("rejects an invalid contract body", async () => {
    const response = handlePutSpaceContractUseCase({
      body: {
        dispatchPolicy: {
          mode: "listen_everything",
        },
      },
      store: {
        readSpaceContract: () => null,
        upsertSpaceContract: () => {
          throw new Error("should not write invalid contracts");
        },
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "space.contract.invalid_body",
    });
  });

  it("patches only selected contract fields and preserves untouched fields", async () => {
    let current: SpaceContract = {
      ...buildDefaultSpaceContract({
        version: 4,
        updatedAt: "2026-03-20T00:00:00.000Z",
        updatedBy: "profile-1",
      }),
      publicationMode: "raw_context_sharing" as const,
      spaceNote: "Keep this note.",
    };

    const response = handlePatchSpaceContractUseCase({
      body: {
        allowedActions: ["post_status", "stay_silent"],
        dispatchBrief: "none",
      },
      store: {
        readSpaceContract: () => current,
        upsertSpaceContract: (nextContract) => {
          current = nextContract;
        },
      },
      updatedBy: "profile-2",
      nowIso: "2026-03-21T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 5,
      updatedAt: "2026-03-21T00:00:00.000Z",
      updatedBy: "profile-2",
      publicationMode: "raw_context_sharing",
      allowedActions: ["post_status", "stay_silent"],
      dispatchBrief: "none",
      spaceNote: "Keep this note.",
    });
  });

  it("skips patch writes when allowedActions only differ by order", async () => {
    const current = buildDefaultSpaceContract({
      version: 4,
      updatedAt: "2026-03-20T00:00:00.000Z",
      updatedBy: "profile-1",
    });
    const upsertSpaceContract = vi.fn();

    const response = handlePatchSpaceContractUseCase({
      body: {
        allowedActions: ["stay_silent", "post_status", "post_message"],
      },
      store: {
        readSpaceContract: () => current,
        upsertSpaceContract,
      },
      updatedBy: "profile-2",
      nowIso: "2026-03-21T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(current);
    expect(upsertSpaceContract).not.toHaveBeenCalled();
  });

  it("does not create a first revision when a patch matches the default contract", async () => {
    const upsertSpaceContract = vi.fn();

    const response = handlePatchSpaceContractUseCase({
      body: {
        allowedActions: ["stay_silent", "post_status", "post_message"],
      },
      store: {
        readSpaceContract: () => null,
        upsertSpaceContract,
      },
      updatedBy: "profile-2",
      nowIso: "2026-03-21T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      updatedAt: "2026-03-21T00:00:00.000Z",
      updatedBy: "system",
      ...DEFAULT_SPACE_CONTRACT_FIELDS,
    });
    expect(upsertSpaceContract).not.toHaveBeenCalled();
  });

  it("rejects an empty contract patch body", async () => {
    const response = handlePatchSpaceContractUseCase({
      body: {},
      store: {
        readSpaceContract: () => null,
        upsertSpaceContract: () => {
          throw new Error("should not write invalid contract patches");
        },
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "space.contract.invalid_body",
    });
  });
});
