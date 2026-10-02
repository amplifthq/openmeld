import {
  createSpaceTaskBodySchema,
  listSpaceTasksQuerySchema,
  mutateSpaceTaskBodySchema,
  spaceTaskIdSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
} from "./rpc-http.helpers";

export function registerSpaceTaskRoutes(app: Hono<HonoBindings>): void {
  const collectionRoute = "/v1/spaces/:spaceId/tasks";
  app.get(collectionRoute, (c) => {
    const query = listSpaceTasksQuerySchema.safeParse({
      phase: c.req.query("phase"),
    });
    if (!query.success) {
      return c.json({ message: "Invalid Task filter." }, 400);
    }
    const spaceId = c.req.param("spaceId");
    return executeRpcRoute({
      c,
      route: collectionRoute,
      method: "GET",
      spaceId,
      execute: async () =>
        c.var.coreRpc.listSpaceTasks({
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          spaceId,
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          ...query.data,
        }),
    });
  });
  app.post(collectionRoute, async (c) => {
    const body = createSpaceTaskBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ message: "Invalid Task request." }, 400);
    }
    const spaceId = c.req.param("spaceId");
    return executeRpcRoute({
      c,
      route: collectionRoute,
      method: "POST",
      spaceId,
      execute: async () =>
        c.var.coreRpc.createSpaceTask({
          spaceId,
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          body: body.data,
        }),
    });
  });

  const itemRoute = "/v1/spaces/:spaceId/tasks/:taskId";
  app.get(itemRoute, (c) => {
    const taskId = spaceTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!taskId.success) {
      return c.json({ message: "Invalid Task ID." }, 400);
    }
    const spaceId = c.req.param("spaceId");
    const affordances = c.req.query("includeAffordances");
    if (affordances !== undefined && affordances !== "1") {
      return c.json({ message: "Invalid Task detail option." }, 400);
    }
    return executeRpcRoute({
      c,
      route: itemRoute,
      method: "GET",
      spaceId,
      execute: async () =>
        c.var.coreRpc.getSpaceTask({
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          spaceId,
          taskId: taskId.data,
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          includeAffordances: affordances === "1",
        }),
    });
  });
  app.patch(itemRoute, async (c) => {
    const taskId = spaceTaskIdSchema.safeParse(c.req.param("taskId"));
    const body = mutateSpaceTaskBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!(taskId.success && body.success)) {
      return c.json({ message: "Invalid Task change." }, 400);
    }
    const spaceId = c.req.param("spaceId");
    return executeRpcRoute({
      c,
      route: itemRoute,
      method: "PATCH",
      spaceId,
      execute: async () =>
        c.var.coreRpc.mutateSpaceTask({
          spaceId,
          taskId: taskId.data,
          password: readSpacePasswordHeader(c.req.raw.headers),
          context: buildCoreRpcContext(c),
          body: body.data,
        }),
    });
  });
}
