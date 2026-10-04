import { buildSpaceMessageEvidence } from "@openmeld/protocol";
import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  commitSpaceFileWriteInputSchema,
  copyOwnMessageExcerptBodySchema,
  spaceFileDescriptorSchema,
} from "@openmeld/schemas";
import type { CopyOwnMessageExcerptBody } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcListSignals } from "../rpc/methods";
import { resolveSpaceStub } from "../rpc/space-ref";
import { hashSpaceFileStream } from "../space/application/space-file-stream";
import { mapRpcHttpError } from "./rpc-http-error";

async function readOwnExcerpt(
  c: Context<HonoBindings>,
  copy: CopyOwnMessageExcerptBody
): Promise<string> {
  const actor = c.var.openMeldRequestContext.actorContext;
  if (
    actor.profileKind !== "human" ||
    actor.openMeldProfileId !== copy.source.authorProfileId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "file_root.excerpt_author_required",
      reason: "Only the author can share a selected excerpt of this message.",
    });
  }
  const page = await rpcListSignals(c.env, {
    context: c.var.openMeldRequestContext,
    spaceId: copy.source.spaceId,
    aroundSignalId: copy.source.sourceSignalId,
    beforeCount: 0,
    afterCount: 0,
    signalTypes: ["signal.text"],
  });
  const signal = page.signals.find(
    (item) => item.id === copy.source.sourceSignalId
  );
  if (
    !signal ||
    signal.spaceId !== copy.source.spaceId ||
    signal.type !== "signal.text" ||
    signal.profile.kind !== "human" ||
    signal.profile.profileId !== actor.openMeldProfileId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "file_root.excerpt_author_required",
      reason:
        "The selected message is unavailable or belongs to another author.",
    });
  }
  try {
    await buildSpaceMessageEvidence({
      signal,
      spaceId: copy.source.spaceId,
      version: copy.source.version,
    });
  } catch {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.evidence_version_unavailable",
      reason:
        "The selected message version is no longer available. Select the excerpt again.",
    });
  }
  const characters = Array.from(signal.data.text);
  const { start, end } = copy.source;
  if (end <= start || end > characters.length || end - start > 16_000) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "file_root.excerpt_range_invalid",
      reason: "Select between 1 and 16,000 characters within this message.",
    });
  }
  return characters.slice(start, end).join("");
}

export function registerSpaceFileExcerptRoutes(app: Hono<HonoBindings>): void {
  app.post("/v1/spaces/:spaceId/files/excerpts", async (c) => {
    const body = copyOwnMessageExcerptBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json(
        {
          error: {
            code: "request.invalid",
            message: "Invalid excerpt selection.",
          },
        },
        400
      );
    }
    const copy = body.data;
    const spaceId = c.req.param("spaceId");
    const stub = resolveSpaceStub(c.env.OPENMELD_SPACES, spaceId);
    if (!stub) {
      return c.json(
        { error: { code: "space.not_found", message: "Space not found." } },
        404
      );
    }
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      spaceId,
      requestContext: c.var.openMeldRequestContext,
      password: c.var.spacePassword,
    });
    try {
      const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
      if (!bucket) {
        throw createCoreRpcHttpError({
          status: 503,
          code: "space_file.storage_unavailable",
          reason: "File storage is unavailable.",
        });
      }
      const text = await readOwnExcerpt(c, copy);
      const bytes = new TextEncoder().encode(text);
      const contentDigest = await hashSpaceFileStream(
        new Blob([bytes]).stream()
      );
      const fileId = await buildSpaceFileEntryIdForMutation(
        copy.clientMutationId
      );
      const revisionId = await buildSpaceFileRevisionIdFromDigest({
        baseRevision: null,
        contentDigest,
        clientMutationId: copy.clientMutationId,
        mimeType: "text/plain",
        name: copy.name,
        parentId: copy.parentId,
      });
      const write = commitSpaceFileWriteInputSchema.parse({
        spaceId,
        fileId,
        revisionId,
        baseRevision: null,
        clientMutationId: copy.clientMutationId,
        mimeType: "text/plain",
        sizeBytes: bytes.byteLength,
        name: copy.name,
        parentId: copy.parentId,
        expectedAudienceProfileIds: copy.audienceProfileIds,
      });
      const prepared = await stub.rpcPrepareSpaceFileWrite({
        spaceAccess,
        write,
      });
      if (
        prepared.organizationId !==
        c.var.openMeldRequestContext.activeOrganizationId
      ) {
        throw createCoreRpcHttpError({
          status: 403,
          code: "file_root.organization_mismatch",
          reason: "The source and destination must belong to the active Team.",
        });
      }
      await stub.rpcReserveSpaceExcerptCopy({ spaceAccess, spaceId, copy });
      if (prepared.committedFile) {
        return c.json(
          { file: spaceFileDescriptorSchema.parse(prepared.committedFile) },
          201
        );
      }
      await bucket.put(prepared.objectKey, bytes, {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: {
          sourceSelection: JSON.stringify(copy.source),
          audienceProfileIds: JSON.stringify(
            [...copy.audienceProfileIds].sort()
          ),
        },
      });
      // Recheck source authority and the exact source after storage I/O. The
      // destination Files owner rechecks its audience at the commit boundary.
      await readOwnExcerpt(c, copy);
      const file = await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
      return c.json({ file: spaceFileDescriptorSchema.parse(file) }, 201);
    } catch (error) {
      return mapRpcHttpError(c, error);
    }
  });
}
