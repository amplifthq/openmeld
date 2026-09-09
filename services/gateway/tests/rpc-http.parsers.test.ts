import { describe, expect, it } from "vitest";
import {
  parseCreateSpaceBody,
  parsePatchProfileSpaceHistoryStatusBody,
  parsePatchSpaceCursorBody,
  parsePatchSpaceMetaBody,
  parsePostSignalBody,
  parsePostSpaceMembersBody,
  parseProfileSpaceHistoryListQuery,
  parseQuerySpaceDeletionTombstonesBody,
  parseRemoveSpaceMembersBody,
  parseSpaceRouteParams,
  parseUpsertProfileSpaceHistoryBody,
  parseUpsertSpaceDeletionTombstoneBody,
  parseUpsertSpacePasswordBody,
  readJsonRequestBody,
} from "../src/routes/rpc-http.parsers";

const VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID =
  "11111111-1111-4111-8111-111111111111";
const VALID_MEMBER_NOTICE_TARGET_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";

describe("rpc-http parsers", () => {
  it("reads an empty JSON request body as undefined", async () => {
    const result = await readJsonRequestBody(
      new Request("http://local/v1/test", {
        method: "POST",
      })
    );

    expect(result).toEqual({
      ok: true,
      value: undefined,
      rawBody: "",
    });
  });

  it("returns Invalid JSON for malformed JSON request bodies", async () => {
    const result = await readJsonRequestBody(
      new Request("http://local/v1/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      })
    );

    expect(result).toEqual({
      ok: false,
      message: "Invalid JSON",
      rawBody: "{",
    });
  });

  it("cancels a chunked body as soon as the byte limit is exceeded", async () => {
    let produced = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
      pull: (controller) => {
        produced += 1;
        controller.enqueue(new Uint8Array(512));
        if (produced >= 128) {
          controller.close();
        }
      },
    });
    const result = await readJsonRequestBody(
      new Request("http://local/v1/test", {
        body,
        method: "POST",
      }),
      { maxBytes: 1024 }
    );

    expect(result).toEqual({
      ok: false,
      message: "Payload too large",
      rawBody: "",
    });
    expect(cancelled).toBe(true);
    expect(produced).toBeLessThan(128);
  });

  it("parses shared space route params", () => {
    expect(parseSpaceRouteParams(" demo-space ")).toEqual({
      ok: true,
      value: {
        spaceId: "demo-space",
      },
    });
  });

  it("rejects invalid shared space route params", () => {
    expect(parseSpaceRouteParams("   ")).toEqual({
      ok: false,
      message: "Too small: expected string to have >=1 characters",
    });
  });

  it("parses create-space body and trims supported fields", () => {
    const parsed = parseCreateSpaceBody({
      name: "  welcome-to-openmeld  ",
      purpose: "  coordinate a launch  ",
      guide: "  stay focused  ",
      visibility: "private",
      accessMode: "public_view_join_password",
      password: "  trim me  ",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "welcome-to-openmeld",
        purpose: "coordinate a launch",
        guide: "stay focused",
        visibility: "private",
        accessMode: "public_view_join_password",
        password: "trim me",
      },
    });
  });

  it("rejects create-space password-gated access without password", () => {
    const parsed = parseCreateSpaceBody({
      visibility: "private",
      accessMode: "public_view_join_password",
    });

    expect(parsed).toEqual({
      ok: false,
      message: "Password required for this access",
    });
  });

  it("rejects create-space public access with password", () => {
    const parsed = parseCreateSpaceBody({
      visibility: "private",
      accessMode: "public",
      password: "abc123",
    });

    expect(parsed).toEqual({
      ok: false,
      message: "Password cannot be set for this access",
    });
  });

  it("rejects create-space unknown field", () => {
    const parsed = parseCreateSpaceBody({
      name: "welcome-to-openmeld",
      creator: { profileId: "agt_1" },
    });

    expect(parsed).toEqual({
      ok: false,
      message: 'Invalid create payload: unknown field "creator"',
    });
  });

  it("keeps create-space behavior for non-object body", () => {
    const parsed = parseCreateSpaceBody(1);
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
  });

  it("rejects create-space array body", () => {
    const parsed = parseCreateSpaceBody([]);
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
  });

  it("rejects absent create-space body", () => {
    const parsed = parseCreateSpaceBody(undefined);
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
  });

  it("rejects create-space null body", () => {
    const parsed = parseCreateSpaceBody(null);
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
  });

  it("returns Invalid guide for invalid create-space guide", () => {
    const parsed = parseCreateSpaceBody({
      visibility: "private",
      guide: 1,
    });
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid guide",
    });
  });

  it("returns Invalid purpose for invalid create-space purpose", () => {
    const parsed = parseCreateSpaceBody({
      visibility: "private",
      purpose: 1,
    });
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid purpose",
    });
  });

  it("returns Invalid password for invalid create-space password", () => {
    const parsed = parseCreateSpaceBody({
      visibility: "private",
      password: 123,
    });
    expect(parsed).toEqual({
      ok: false,
      message: "Invalid password",
    });
  });

  it("parses upsert password body with canonical password whitespace", () => {
    const parsed = parseUpsertSpacePasswordBody({
      password: "  trim-here  ",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        password: "trim-here",
      },
    });
  });

  it("returns stable errors for invalid upsert password body", () => {
    expect(parseUpsertSpacePasswordBody(null)).toEqual({
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload",
    });
    expect(
      parseUpsertSpacePasswordBody({
        password: 1,
      })
    ).toEqual({
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload",
    });
    expect(
      parseUpsertSpacePasswordBody({
        password: "valid-pass",
        unknown: true,
      })
    ).toEqual({
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload",
    });
  });

  it("parses patch meta body", () => {
    expect(parsePatchSpaceMetaBody({ visibility: "public" })).toEqual({
      ok: true,
      value: { visibility: "public" },
    });
    const parsed = parsePatchSpaceMetaBody({
      purpose: "coordinate launch sequencing",
      guide: "keep it short",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        purpose: "coordinate launch sequencing",
        guide: "keep it short",
      },
    });
  });

  it("parses add-members body with the shared contract", () => {
    expect(
      parsePostSpaceMembersBody({
        memberProfileIds: [VALID_MEMBER_NOTICE_TARGET_PROFILE_ID],
      })
    ).toEqual({
      ok: true,
      value: {
        memberProfileIds: [VALID_MEMBER_NOTICE_TARGET_PROFILE_ID],
      },
    });
  });

  it("returns stable errors for invalid add-members payloads", () => {
    expect(parsePostSpaceMembersBody(undefined)).toEqual({
      ok: false,
      message: "Invalid input: expected object, received undefined",
    });
    expect(
      parsePostSpaceMembersBody({
        memberProfileIds: [],
      })
    ).toEqual({
      ok: false,
      message: "Too small: expected array to have >=1 items",
    });
  });

  it("parses remove-members body with the shared contract", () => {
    expect(
      parseRemoveSpaceMembersBody({
        memberProfileIds: [VALID_MEMBER_NOTICE_TARGET_PROFILE_ID],
      })
    ).toEqual({
      ok: true,
      value: {
        memberProfileIds: [VALID_MEMBER_NOTICE_TARGET_PROFILE_ID],
      },
    });
  });

  it("returns stable errors for invalid remove-members payloads", () => {
    expect(parseRemoveSpaceMembersBody(undefined)).toEqual({
      ok: false,
      message: "Invalid input: expected object, received undefined",
    });
    expect(
      parseRemoveSpaceMembersBody({
        memberProfileIds: [],
      })
    ).toEqual({
      ok: false,
      message: "Too small: expected array to have >=1 items",
    });
  });

  it("rejects unknown field in patch meta body", () => {
    const parsed = parsePatchSpaceMetaBody({
      guide: "keep it short",
      creator: { profileId: "agt_1" },
    });

    expect(parsed).toEqual({
      ok: false,
      message: "Unknown field: creator",
    });
  });

  it("returns stable errors for patch meta when supported fields are missing or invalid", () => {
    expect(parsePatchSpaceMetaBody({})).toEqual({
      ok: false,
      message: "Expected name, purpose, guide or visibility",
    });
    expect(
      parsePatchSpaceMetaBody({
        guide: 0,
      })
    ).toEqual({
      ok: false,
      message: "Invalid input: expected string, received number",
    });
    expect(
      parsePatchSpaceMetaBody({
        purpose: 0,
      })
    ).toEqual({
      ok: false,
      message: "Invalid input: expected string, received number",
    });
  });

  it("parses patch cursor body with trim + optional fields", () => {
    const parsed = parsePatchSpaceCursorBody({
      lastSeenTs: 10,
      role: "  helper  ",
      mentionAlias: "  triage_bot  ",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        lastSeenTs: 10,
        role: "helper",
        mentionAlias: "triage_bot",
      },
    });
  });

  it("normalizes patch cursor lastSeenTs values", () => {
    expect(parsePatchSpaceCursorBody({ lastSeenTs: -4 })).toEqual({
      ok: true,
      value: {
        lastSeenTs: 0,
      },
    });
    expect(parsePatchSpaceCursorBody({ lastSeenTs: 4.9 })).toEqual({
      ok: true,
      value: {
        lastSeenTs: 4,
      },
    });
    expect(
      parsePatchSpaceCursorBody({
        lastSeenTs: Number.POSITIVE_INFINITY,
        role: "helper",
      })
    ).toEqual({
      ok: true,
      value: {
        role: "helper",
      },
    });
  });

  it("returns stable patch cursor validation messages", () => {
    expect(parsePatchSpaceCursorBody(undefined)).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
    expect(parsePatchSpaceCursorBody({})).toEqual({
      ok: false,
      message: "Expected lastSeenTs, role or mentionAlias",
    });
    expect(
      parsePatchSpaceCursorBody({
        lastSeenTs: Number.NaN,
      })
    ).toEqual({
      ok: false,
      message: "Expected lastSeenTs, role or mentionAlias",
    });
    expect(
      parsePatchSpaceCursorBody({
        lastSeenTs: "10",
      })
    ).toEqual({
      ok: false,
      message: "Invalid lastSeenTs",
    });
    expect(
      parsePatchSpaceCursorBody({
        role: 1,
      })
    ).toEqual({
      ok: false,
      message: "Invalid role",
    });
    const retiredCursorField = ["role", "Instructions"].join("");
    expect(parsePatchSpaceCursorBody({ [retiredCursorField]: 1 })).toEqual({
      ok: false,
      message: `Unrecognized key: "${retiredCursorField}"`,
    });
    expect(
      parsePatchSpaceCursorBody({
        mentionAlias: 1,
      })
    ).toEqual({
      ok: false,
      message: "Invalid mentionAlias",
    });
  });

  it("parses post-signal body via shared normal message schema", () => {
    const deviceWait = {
      bindingId: "binding-wait",
      openMeldServiceRuntimeId: "runtime-wait",
      targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deadlineAtMs: Date.now() + 60_000,
    };
    expect(
      parsePostSignalBody({
        text: "Check the report",
        deviceWait,
        meta: { clientMessageId: "device-wait-message" },
      })
    ).toMatchObject({ ok: true, value: { deviceWait } });
    for (const topLevel of [undefined, deviceWait]) {
      expect(
        parsePostSignalBody({
          text: "Check the report",
          ...(topLevel ? { deviceWait: topLevel } : {}),
          meta: { clientMessageId: "device-wait-message", deviceWait },
        })
      ).toMatchObject({ ok: false });
    }
    const parsed = parsePostSignalBody({
      text: "hello",
      messageEnvelope: {
        text: "hello",
        activationTargets: [],
        referenceTargets: [],
      },
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
        targetProfileKind: "agent",
        targetProfileName: "Demo Bot",
        addedByProfileId: VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID,
        addedByDisplayName: "Mira",
      },
      replyTo: {
        signalId: "sig-reply",
        profileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
        profileKind: "agent",
        profileName: "Demo Bot",
        previewText: "Earlier reply",
      },
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        text: "hello",
        messageEnvelope: {
          text: "hello",
          activationTargets: [],
          referenceTargets: [],
        },
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
          targetProfileKind: "agent",
          targetProfileName: "Demo Bot",
          addedByProfileId: VALID_MEMBER_NOTICE_ACTOR_PROFILE_ID,
          addedByDisplayName: "Mira",
        },
        replyTo: {
          signalId: "sig-reply",
          profileId: VALID_MEMBER_NOTICE_TARGET_PROFILE_ID,
          profileKind: "agent",
          profileName: "Demo Bot",
          previewText: "Earlier reply",
        },
      },
    });
  });

  it("returns shared schema validation errors for invalid post-signal payload", () => {
    const parsed = parsePostSignalBody({
      text: "hello",
      messageEnvelope: {
        text: "bye",
        activationTargets: [],
        referenceTargets: [],
      },
    });
    expect(parsed).toEqual({
      ok: false,
      message: "messageEnvelope.text must match text",
    });
  });

  it("parses profile space history list query values", () => {
    const parsed = parseProfileSpaceHistoryListQuery({
      gatewayHost: "http://LOCALHOST:8080",
      status: ["active", "removed"],
      limit: "50",
      pinned: "true",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        gatewayHost: "localhost:8080",
        status: ["active", "removed"],
        limit: 50,
        pinned: true,
      },
    });
  });

  it("returns stable errors for profile space history list query", () => {
    expect(
      parseProfileSpaceHistoryListQuery({
        gatewayHost: "",
      })
    ).toEqual({
      ok: false,
      message: "Invalid gatewayHost",
    });

    expect(
      parseProfileSpaceHistoryListQuery({
        gatewayHost: "localhost:8080",
        limit: "abc",
      })
    ).toEqual({
      ok: false,
      message: "Invalid limit",
    });

    expect(
      parseProfileSpaceHistoryListQuery({
        gatewayHost: "localhost:8080",
        pinned: "yes",
      })
    ).toEqual({
      ok: false,
      message: "Invalid pinned",
    });
  });

  it("parses upsert profile space history payload", () => {
    const parsed = parseUpsertProfileSpaceHistoryBody({
      gatewayHost: "localhost:8080",
      spaceName: "ops-room",
      creatorProfileId: "agt_executor",
      creatorKind: "agent",
      spaceCreatedAt: "2026-02-24T00:00:00.000Z",
      spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
      lastJoinedAt: "2026-02-24T00:00:02.000Z",
      lastSeenTs: 42,
      pinnedAt: null,
      status: "active",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        gatewayHost: "localhost:8080",
        spaceName: "ops-room",
        creatorProfileId: "agt_executor",
        creatorKind: "agent",
        spaceCreatedAt: "2026-02-24T00:00:00.000Z",
        spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
        lastJoinedAt: "2026-02-24T00:00:02.000Z",
        lastSeenTs: 42,
        pinnedAt: null,
        status: "active",
      },
    });
  });

  it("returns stable errors for upsert profile space history payload", () => {
    expect(parseUpsertProfileSpaceHistoryBody([])).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
    expect(
      parseUpsertProfileSpaceHistoryBody({
        gatewayHost: "localhost:8080",
        lastSeenTs: -1,
      })
    ).toEqual({
      ok: false,
      message: "Invalid lastSeenTs",
    });
    expect(
      parseUpsertProfileSpaceHistoryBody({
        gatewayHost: "localhost:8080",
        pinnedAt: "",
      })
    ).toEqual({
      ok: false,
      message: "Invalid pinnedAt",
    });
  });

  it("parses profile space history status patch body", () => {
    const parsed = parsePatchProfileSpaceHistoryStatusBody({
      gatewayHost: "localhost:8080",
      status: "inaccessible",
      reason: "forbidden",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        gatewayHost: "localhost:8080",
        status: "inaccessible",
        reason: "forbidden",
      },
    });
  });

  it("returns stable errors for profile space history status patch body", () => {
    expect(parsePatchProfileSpaceHistoryStatusBody(null)).toEqual({
      ok: false,
      message: "Invalid JSON",
    });

    expect(
      parsePatchProfileSpaceHistoryStatusBody({
        gatewayHost: "localhost:8080",
        status: "unknown",
      })
    ).toEqual({
      ok: false,
      message: "Invalid status",
    });
  });

  it("parses space deletion tombstone query body", () => {
    const parsed = parseQuerySpaceDeletionTombstonesBody({
      gatewayHost: "http://LOCALHOST:8080",
      spaceIds: ["space-a", "space-a", "space-b"],
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        gatewayHost: "localhost:8080",
        spaceIds: ["space-a", "space-b"],
      },
    });
  });

  it("returns stable errors for space deletion tombstone query body", () => {
    expect(parseQuerySpaceDeletionTombstonesBody(null)).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
    expect(
      parseQuerySpaceDeletionTombstonesBody({
        gatewayHost: "localhost:8080",
        spaceIds: [],
      })
    ).toEqual({
      ok: false,
      message: "Invalid spaceIds",
    });
  });

  it("parses space deletion tombstone upsert body", () => {
    const parsed = parseUpsertSpaceDeletionTombstoneBody({
      gatewayHost: "localhost:8080",
      spaceName: "ops-room",
      creatorProfileId: "agt_executor",
      creatorKind: "agent",
      deletedAt: "2026-03-12T00:00:00.000Z",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        gatewayHost: "localhost:8080",
        spaceName: "ops-room",
        creatorProfileId: "agt_executor",
        creatorKind: "agent",
        deletedAt: "2026-03-12T00:00:00.000Z",
      },
    });
  });

  it("returns stable errors for space deletion tombstone upsert body", () => {
    expect(parseUpsertSpaceDeletionTombstoneBody([])).toEqual({
      ok: false,
      message: "Invalid JSON",
    });
    expect(
      parseUpsertSpaceDeletionTombstoneBody({
        gatewayHost: "localhost:8080",
        deletedAt: "nope",
      })
    ).toEqual({
      ok: false,
      message: "Invalid deletedAt",
    });
  });
});
