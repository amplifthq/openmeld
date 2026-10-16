import {
  createSpaceFolderBodySchema,
  fileRootEntrySchema,
  fileRootFileDescriptorSchema,
  fileRootFolderDescriptorSchema,
  listFileRootResponseSchema,
  listSpaceFilesQuerySchema,
  restoreSpaceFileEntryBodySchema,
  trashSpaceFileEntryBodySchema,
  updateSpaceFileEntryBodySchema,
} from "@openmeld/schemas";
import type {
  FileRoot,
  OpenMeldRequestContext,
  SpaceFileEntry,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import {
  type OrganizationFileRoot,
  organizationFileRootName,
} from "../files/file-root-identity";
import type { OrganizationFileRoot as OrganizationFileRootObject } from "../files/organization-file-root";
import type { HonoBindings } from "../lib/bindings";
import { mapRpcHttpError } from "./rpc-http-error";

export type FileRootTarget = {
  context: OpenMeldRequestContext;
  root: OrganizationFileRoot;
  rootId: string;
  stub: DurableObjectStub<OrganizationFileRootObject>;
};

export function registerFileRootRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/organizations/current/files/:location", (c) => list(c));
  app.post("/v1/organizations/current/files/:location/folders", (c) =>
    createFolder(c)
  );
  app.get("/v1/organizations/current/files/:location/:entryId/revisions", (c) =>
    listRevisions(c)
  );
  app.get("/v1/organizations/current/files/:location/:entryId", (c) =>
    getFile(c)
  );
  app.patch("/v1/organizations/current/files/:location/:entryId", (c) =>
    updateEntry(c)
  );
  app.delete("/v1/organizations/current/files/:location/:entryId", (c) =>
    trashEntry(c)
  );
  app.post("/v1/organizations/current/files/:location/:entryId/restore", (c) =>
    restoreEntry(c)
  );
}

async function list(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const query = listSpaceFilesQuerySchema.safeParse({
    ...(c.req.query("parentId") ? { parentId: c.req.query("parentId") } : {}),
    ...(c.req.query("view") ? { view: c.req.query("view") } : {}),
  });
  if (!query.success) {
    return invalidPayload(c);
  }
  try {
    const response = await target.stub.list({
      ...rootRequest(target),
      query: query.data,
    });
    return c.json(
      listFileRootResponseSchema.parse({
        root: target.root,
        parentId: response.parentId,
        view: response.view,
        breadcrumbs: response.breadcrumbs,
        entries: response.entries.map((entry) =>
          toFileRootEntry(target.root, entry)
        ),
        capabilities: response.capabilities,
      })
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function createFolder(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const body = createSpaceFolderBodySchema.safeParse(await readBody(c));
  if (!body.success) {
    return invalidPayload(c);
  }
  try {
    const folder = await target.stub.createFolder({
      ...rootRequest(target),
      body: body.data,
    });
    return c.json({
      folder: fileRootFolderDescriptorSchema.parse(
        toFileRootEntry(target.root, folder)
      ),
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function getFile(
  c: Context<HonoBindings, "/v1/organizations/current/files/:location/:entryId">
): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  try {
    const file = await target.stub.getFile({
      ...rootRequest(target),
      fileId: c.req.param("entryId"),
    });
    return c.json({
      file: fileRootFileDescriptorSchema.parse(
        toFileRootEntry(target.root, file)
      ),
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function listRevisions(
  c: Context<HonoBindings, "/v1/organizations/current/files/:location/:entryId">
): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  try {
    const fileId = c.req.param("entryId");
    const [file, revisions] = await Promise.all([
      target.stub.getFile({ ...rootRequest(target), fileId }),
      target.stub.listRevisions({ ...rootRequest(target), fileId }),
    ]);
    return c.json({
      file: fileRootFileDescriptorSchema.parse(
        toFileRootEntry(target.root, file)
      ),
      revisions,
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function updateEntry(
  c: Context<HonoBindings, "/v1/organizations/current/files/:location/:entryId">
): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const body = updateSpaceFileEntryBodySchema.safeParse(await readBody(c));
  if (!body.success) {
    return invalidPayload(c);
  }
  try {
    const entry = await target.stub.updateEntry({
      ...rootRequest(target),
      body: body.data,
      entryId: c.req.param("entryId"),
    });
    return c.json({
      entry: fileRootEntrySchema.parse(toFileRootEntry(target.root, entry)),
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function trashEntry(
  c: Context<HonoBindings, "/v1/organizations/current/files/:location/:entryId">
): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const body = trashSpaceFileEntryBodySchema.safeParse(await readBody(c));
  if (!body.success) {
    return invalidPayload(c);
  }
  try {
    return c.json(
      await target.stub.trashEntry({
        ...rootRequest(target),
        body: body.data,
        entryId: c.req.param("entryId"),
      })
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function restoreEntry(
  c: Context<HonoBindings, "/v1/organizations/current/files/:location/:entryId">
): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const body = restoreSpaceFileEntryBodySchema.safeParse(await readBody(c));
  if (!body.success) {
    return invalidPayload(c);
  }
  try {
    const entry = await target.stub.restoreEntry({
      ...rootRequest(target),
      body: body.data,
      entryId: c.req.param("entryId"),
    });
    return c.json({
      entry: fileRootEntrySchema.parse(toFileRootEntry(target.root, entry)),
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

export function resolveTarget(
  c: Context<HonoBindings>
): FileRootTarget | Response {
  return resolveFileRootTarget(c, c.req.param("location"));
}

export function resolveFileRootTarget(
  c: Context<HonoBindings>,
  location: string | undefined
): FileRootTarget | Response {
  const context = c.var.openMeldRequestContext;
  const organizationId = context.activeOrganizationId;
  const memberUserId = context.actorContext.callerPrincipalId;
  if (!(organizationId && memberUserId)) {
    return c.json(
      {
        error: {
          code: "file_root.context_required",
          message: "Choose an Organization first.",
        },
      },
      403
    );
  }
  let root: OrganizationFileRoot;
  if (location === "team") {
    root = { kind: "team", organizationId };
  } else if (location === "my") {
    root = { kind: "member", organizationId, memberUserId };
  } else {
    return c.json(
      {
        error: {
          code: "file_root.not_found",
          message: "Files location not found.",
        },
      },
      404
    );
  }
  const namespace = c.env.OPENMELD_FILE_ROOTS;
  if (!namespace) {
    return c.json(
      {
        error: {
          code: "file_root.unavailable",
          message: "Files are temporarily unavailable.",
        },
      },
      503
    );
  }
  const id = namespace.idFromName(organizationFileRootName(root));
  return { context, root, rootId: id.toString(), stub: namespace.get(id) };
}

export function toFileRootEntry(root: FileRoot, entry: SpaceFileEntry) {
  const { spaceId: _internalRootId, ...details } = entry;
  return { ...details, root };
}

export function rootRequest(target: FileRootTarget) {
  return { context: target.context, root: target.root };
}

function invalidPayload(c: Context<HonoBindings>): Response {
  return c.json(
    { error: { code: "invalid_payload", message: "Invalid Files request." } },
    400
  );
}

async function readBody(c: Context<HonoBindings>): Promise<unknown> {
  return await c.req.json().catch(() => null);
}
