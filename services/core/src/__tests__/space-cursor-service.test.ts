import type { SpaceCursor } from "@openmeld/protocol";
import { MAX_TEXT_LENGTH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { handlePatchCursorUseCase } from "../space/application/space-cursor-service";
import type { SpaceCursorRecord } from "../space/rules/parsers/space-cursor";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PROFILE_ID = "agt_cursor";

function createCursorRecord(
  overrides: Partial<SpaceCursorRecord> = {}
): SpaceCursorRecord {
  return {
    v: 1,
    spaceId: SPACE_ID,
    profileId: PROFILE_ID,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function toPublicSpaceCursor(cursor: SpaceCursorRecord): SpaceCursor {
  return {
    spaceId: cursor.spaceId,
    profileId: cursor.profileId,
    ...(typeof cursor.lastSeenTs === "number"
      ? { lastSeenTs: cursor.lastSeenTs }
      : {}),
    ...(cursor.role ? { role: cursor.role } : {}),
    ...(cursor.mentionAlias ? { mentionAlias: cursor.mentionAlias } : {}),
    createdAt: cursor.createdAt,
    updatedAt: cursor.updatedAt,
  };
}

function createCursorHarness(input?: {
  existing?: SpaceCursorRecord | null;
  mentionAliasOwners?: Map<string, string>;
  nowMs?: number;
}) {
  let storedCursor = input?.existing ?? null;
  const mentionAliasOwners = input?.mentionAliasOwners ?? new Map();

  return {
    getStoredCursor: () => storedCursor,
    patch: (body: unknown) =>
      handlePatchCursorUseCase({
        body,
        profileId: PROFILE_ID,
        spaceId: SPACE_ID,
        nowMs: () => input?.nowMs ?? 1000,
        readSpaceCursorRecord: () => storedCursor,
        readCursorProfileIdByMentionAlias: (mentionAlias) =>
          mentionAliasOwners.get(mentionAlias) ?? null,
        upsertSpaceCursorRecord: (cursor) => {
          storedCursor = cursor;
        },
        toPublicSpaceCursor,
      }),
  };
}

describe("space cursor service", () => {
  it("normalizes decimal lastSeenTs and keeps lastSeenTs monotonic", async () => {
    const harness = createCursorHarness({
      existing: createCursorRecord({ lastSeenTs: 10 }),
    });

    const response = harness.patch({ lastSeenTs: 12.9 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lastSeenTs: 12,
    });
    expect(harness.getStoredCursor()?.lastSeenTs).toBe(12);
  });

  it("normalizes negative lastSeenTs to zero", async () => {
    const harness = createCursorHarness();

    const response = harness.patch({ lastSeenTs: -3 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lastSeenTs: 0,
    });
    expect(harness.getStoredCursor()?.lastSeenTs).toBe(0);
  });

  it("rejects a lastSeenTs far in the future", async () => {
    const harness = createCursorHarness({ nowMs: 1000 });

    const response = harness.patch({ lastSeenTs: 301_001 });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "lastSeenTs is too far in the future"
    );
    expect(harness.getStoredCursor()).toBeNull();
  });

  it("rejects a non-finite-only lastSeenTs patch as empty", async () => {
    const harness = createCursorHarness();

    const response = harness.patch({ lastSeenTs: Number.POSITIVE_INFINITY });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Expected lastSeenTs, role or mentionAlias"
    );
    expect(harness.getStoredCursor()).toBeNull();
  });

  it("omits non-finite lastSeenTs while applying other patch fields", async () => {
    const harness = createCursorHarness({
      existing: createCursorRecord({ lastSeenTs: 10 }),
    });

    const response = harness.patch({
      lastSeenTs: Number.NaN,
      role: "  helper  ",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lastSeenTs: 10,
      role: "helper",
    });
    expect(harness.getStoredCursor()).toMatchObject({
      lastSeenTs: 10,
      role: "helper",
    });
  });

  it("clears existing string fields when blank strings are present", async () => {
    const harness = createCursorHarness({
      existing: createCursorRecord({
        role: "planner",
        mentionAlias: "codex_agent",
      }),
    });

    const response = harness.patch({
      role: "   ",
      mentionAlias: "   ",
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SpaceCursor;
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("mentionAlias");
    expect(harness.getStoredCursor()).not.toHaveProperty("role");
    expect(harness.getStoredCursor()).not.toHaveProperty("mentionAlias");
  });

  it("keeps absent string fields absent when blank strings are present", async () => {
    const harness = createCursorHarness();

    const response = harness.patch({ role: "   " });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SpaceCursor;
    expect(payload).not.toHaveProperty("role");
    expect(harness.getStoredCursor()).not.toHaveProperty("role");
  });

  it("rejects invalid mentionAlias tokens", async () => {
    const harness = createCursorHarness();

    const response = harness.patch({ mentionAlias: "invalid alias" });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid mentionAlias");
    expect(harness.getStoredCursor()).toBeNull();
  });

  it("rejects roles that exceed the shared text limit", async () => {
    const roleHarness = createCursorHarness();
    const roleResponse = roleHarness.patch({
      role: "x".repeat(MAX_TEXT_LENGTH + 1),
    });

    expect(roleResponse.status).toBe(400);
    await expect(roleResponse.text()).resolves.toBe("Role too long");
    expect(roleHarness.getStoredCursor()).toBeNull();
  });

  it("rejects retired cursor fields", async () => {
    const harness = createCursorHarness();
    const retiredCursorField = ["role", "Instructions"].join("");
    const response = harness.patch({
      role: "planner",
      [retiredCursorField]: "Keep it short.",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      `Unrecognized key: "${retiredCursorField}"`
    );
    expect(harness.getStoredCursor()).toBeNull();
  });
});
