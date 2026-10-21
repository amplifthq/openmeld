import { randomUUID } from "node:crypto";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCreateSpace,
  rpcDeleteSpaceAttachmentRecord,
  rpcListSignals,
  rpcPostSignal,
  rpcRecordSpaceAttachment,
  rpcResolveSpaceAttachmentForDownload,
} from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

const coreEnv = env as unknown as CoreBindings;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBERSHIP_REQUIRED_RPC_ERROR_PATTERN =
  /HTTP 403.*space\.membership_required/;
const SPACE_FORBIDDEN_RPC_ERROR_PATTERN = /HTTP 403.*space\.forbidden/;
describe("Space attachment Core RPC", () => {
  it("records and resolves an attachment for an active Space member", async () => {
    const fixture = await createFixture();
    const spaceId = await createPublicSpace(fixture.memberContext);
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: fixture.memberContext,
      spaceId,
    });
    const attachment = await rpcRecordSpaceAttachment(coreEnv, {
      fileName: "photo.png",
      height: 600,
      mimeType: "image/png",
      sizeBytes: 1024,
      spaceAccess,
      spaceId,
      width: 800,
    });
    expect(attachment).toMatchObject({
      fileName: "photo.png",
      height: 600,
      mimeType: "image/png",
      organizationId: fixture.organizationId,
      sizeBytes: 1024,
      spaceId,
      width: 800,
    });
    expect(attachment.id).toMatch(UUID_V4_PATTERN);
    expect(Number.isNaN(Date.parse(attachment.createdAt))).toBe(false);
    await expect(
      rpcResolveSpaceAttachmentForDownload(coreEnv, {
        attachmentId: attachment.id,
        spaceAccess,
        spaceId,
      })
    ).resolves.toEqual(attachment);
  });
  it("rejects an authenticated Organization member who is not a Space member", async () => {
    const fixture = await createFixture();
    const nonMemberContext = await addOrganizationMember({
      organizationId: fixture.organizationId,
    });
    const spaces = [
      {
        errorPattern: MEMBERSHIP_REQUIRED_RPC_ERROR_PATTERN,
        spaceId: await createPublicSpace(fixture.memberContext),
      },
      {
        errorPattern: SPACE_FORBIDDEN_RPC_ERROR_PATTERN,
        spaceId: await createProtectedSpace(fixture.memberContext),
      },
    ];
    for (const { errorPattern, spaceId } of spaces) {
      await expect(
        rpcRecordSpaceAttachment(coreEnv, {
          context: nonMemberContext,
          mimeType: "image/jpeg",
          sizeBytes: 3,
          spaceId,
        })
      ).rejects.toThrow(errorPattern);
    }
  });
  it("does not resolve an attachment through another Space", async () => {
    const fixture = await createFixture();
    const sourceSpaceId = await createPublicSpace(fixture.memberContext);
    const otherSpaceId = await createPublicSpace(fixture.memberContext);
    const attachment = await rpcRecordSpaceAttachment(coreEnv, {
      context: fixture.memberContext,
      mimeType: "image/jpeg",
      sizeBytes: 3,
      spaceId: sourceSpaceId,
    });
    await expect(
      rpcResolveSpaceAttachmentForDownload(coreEnv, {
        attachmentId: attachment.id,
        context: fixture.memberContext,
        spaceId: otherSpaceId,
      })
    ).rejects.toMatchObject({
      code: "attachment_not_found",
      status: 404,
    });
  });
  it("rejects a message that references a missing attachment", async () => {
    const fixture = await createFixture();
    const spaceId = await createPublicSpace(fixture.memberContext);
    await expect(
      postAttachmentMessage({
        attachments: [
          {
            id: randomUUID(),
            mimeType: "image/png",
            sizeBytes: 1024,
          },
        ],
        context: fixture.memberContext,
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "attachment_reference_invalid",
      status: 422,
    });
    const history = await rpcListSignals(coreEnv, {
      context: fixture.memberContext,
      recent: true,
      spaceId,
    });
    expect(history.signals).toHaveLength(0);
  });
  it("rejects a message that references an attachment from another Space", async () => {
    const fixture = await createFixture();
    const sourceSpaceId = await createPublicSpace(fixture.memberContext);
    const targetSpaceId = await createPublicSpace(fixture.memberContext);
    const attachment = await rpcRecordSpaceAttachment(coreEnv, {
      context: fixture.memberContext,
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      spaceId: sourceSpaceId,
    });
    await expect(
      postAttachmentMessage({
        attachments: [toMessageAttachment(attachment)],
        context: fixture.memberContext,
        spaceId: targetSpaceId,
      })
    ).rejects.toMatchObject({
      code: "attachment_reference_invalid",
      status: 422,
    });
    const history = await rpcListSignals(coreEnv, {
      context: fixture.memberContext,
      recent: true,
      spaceId: targetSpaceId,
    });
    expect(history.signals).toHaveLength(0);
  });
  it("persists canonical attachment metadata and returns it in history", async () => {
    const fixture = await createFixture();
    const spaceId = await createPublicSpace(fixture.memberContext);
    const attachment = await rpcRecordSpaceAttachment(coreEnv, {
      context: fixture.memberContext,
      fileName: "diagram.png",
      height: 600,
      mimeType: "image/png",
      sizeBytes: 1024,
      spaceId,
      width: 800,
    });
    const canonicalReference = toMessageAttachment(attachment);
    const posted = await postAttachmentMessage({
      attachments: [
        {
          id: attachment.id,
          mimeType: "image/jpeg",
          sizeBytes: 1,
        },
      ],
      context: fixture.memberContext,
      spaceId,
    });
    expect(posted).toMatchObject({
      type: "signal.text",
      data: {
        text: "Here is the latest diagram.",
        attachments: [canonicalReference],
      },
    });
    const history = await rpcListSignals(coreEnv, {
      context: fixture.memberContext,
      recent: true,
      spaceId,
    });
    expect(history.signals).toEqual([
      expect.objectContaining({
        id: posted.id,
        data: expect.objectContaining({
          attachments: [canonicalReference],
        }),
      }),
    ]);
  });
  it("rejects attachment access when the Space belongs to another active Organization", async () => {
    const fixture = await createFixture();
    const spaceId = await createPublicSpace(fixture.memberContext);
    const otherOrganizationId = `org-attachment-${randomUUID()}`;
    const userId = fixture.memberContext.actorContext.callerPrincipalId;
    if (!userId) {
      throw new Error("Attachment fixture must have an authenticated user id");
    }
    await ensureOrganizationMembership({
      organizationId: otherOrganizationId,
      userId,
    });
    await expect(
      rpcRecordSpaceAttachment(coreEnv, {
        context: {
          ...fixture.memberContext,
          activeOrganizationId: otherOrganizationId,
        },
        mimeType: "image/png",
        sizeBytes: 8,
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "space.organization_mismatch",
      status: 403,
    });
  });
  it("deletes the metadata row used to compensate a failed R2 write", async () => {
    const fixture = await createFixture();
    const spaceId = await createPublicSpace(fixture.memberContext);
    const attachment = await rpcRecordSpaceAttachment(coreEnv, {
      context: fixture.memberContext,
      mimeType: "image/png",
      sizeBytes: 8,
      spaceId,
    });
    await expect(
      rpcDeleteSpaceAttachmentRecord(coreEnv, {
        attachmentId: attachment.id,
      })
    ).resolves.toEqual({ deleted: true });
    await expect(
      rpcResolveSpaceAttachmentForDownload(coreEnv, {
        attachmentId: attachment.id,
        context: fixture.memberContext,
        spaceId,
      })
    ).rejects.toMatchObject({
      code: "attachment_not_found",
      status: 404,
    });
  });
});
function toMessageAttachment(attachment: {
  fileName?: string;
  height?: number;
  id: string;
  mimeType: "image/jpeg" | "image/png";
  sizeBytes: number;
  width?: number;
}) {
  return {
    id: attachment.id,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
    ...(attachment.fileName === undefined
      ? {}
      : { fileName: attachment.fileName }),
  };
}
async function postAttachmentMessage(input: {
  attachments: ReturnType<typeof toMessageAttachment>[];
  context: OpenMeldRequestContext;
  spaceId: string;
}) {
  return await rpcPostSignal(coreEnv, {
    attachments: input.attachments,
    authoringPolicy: "user_authored",
    context: input.context,
    profile: {
      kind: "human",
      profileId: input.context.actorContext.openMeldProfileId,
      profileName: input.context.actorContext.profileName,
    },
    spaceId: input.spaceId,
    text: "Here is the latest diagram.",
  });
}
async function createFixture(): Promise<{
  memberContext: OpenMeldRequestContext;
  organizationId: string;
}> {
  const organizationId = `org-attachment-${randomUUID()}`;
  const memberContext = await addOrganizationMember({ organizationId });
  return { memberContext, organizationId };
}
async function addOrganizationMember(input: {
  organizationId: string;
}): Promise<OpenMeldRequestContext> {
  const nowMs = Date.now();
  const userId = `user-${randomUUID()}`;
  const profileId = randomUUID();
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 1, $4, $5)
    `,
      values: [],
    },
    values: [
      userId,
      "Attachment Test User",
      `${userId}@openmeld.test`,
      nowMs,
      nowMs,
    ],
  });
  await ensureOrganizationMembership({
    organizationId: input.organizationId,
    userId,
  });
  return {
    activeOrganizationId: input.organizationId,
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human",
      profileName: "Attachment Test User",
      requestId: `req-${randomUUID()}`,
      openMeldProfileId: profileId,
    },
  };
}
async function ensureOrganizationMembership(input: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const nowMs = Date.now();
  const organizationSlug = input.organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      values: [],
    },
    values: [
      input.organizationId,
      "Space Attachment Test Organization",
      organizationSlug,
      nowMs,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
      VALUES ($1, $2, $3, 'member', $4)
    `,
      values: [],
    },
    values: [randomUUID(), input.organizationId, input.userId, nowMs],
  });
}
async function createPublicSpace(
  context: OpenMeldRequestContext
): Promise<string> {
  const created = await rpcCreateSpace(coreEnv, {
    context,
    name: "Attachment Test Space",
    visibility: "public",
  });
  return created.spaceId;
}
async function createProtectedSpace(
  context: OpenMeldRequestContext
): Promise<string> {
  const created = await rpcCreateSpace(coreEnv, {
    context,
    name: "Protected Attachment Test Space",
    password: "attachment-test-password",
    visibility: "private",
  });
  return created.spaceId;
}
