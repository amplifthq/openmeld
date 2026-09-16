import {
  localProjectControlConnectCandidateRequestSchema,
  localProjectControlConnectDeclaredPathRequestSchema,
  localProjectControlConnectOutcomeSchema,
  localProjectControlSetDefaultConnectionRequestSchema,
  localProjectControlSetDefaultConnectionResponseSchema,
  peopleComputerTargetSchema,
} from "@openmeld/schemas";
import type { PeopleComputerTarget } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

export function registerPeopleComputerProjectMutationRoutes(
  app: Hono<HonoBindings>
) {
  register(
    "connect-candidate",
    localProjectControlConnectCandidateRequestSchema,
    localProjectControlConnectOutcomeSchema,
    (c, input) =>
      c.var.coreRpc.connectPeopleComputerProjectCandidate({
        ...input,
        context: buildCoreRpcContext(c),
      })
  );
  register(
    "connect-declared-path",
    localProjectControlConnectDeclaredPathRequestSchema,
    localProjectControlConnectOutcomeSchema,
    (c, input) =>
      c.var.coreRpc.connectPeopleComputerProjectPath({
        ...input,
        context: buildCoreRpcContext(c),
      })
  );
  register(
    "connections/set-default",
    localProjectControlSetDefaultConnectionRequestSchema,
    localProjectControlSetDefaultConnectionResponseSchema,
    (c, input) =>
      c.var.coreRpc.setPeopleComputerProjectDefaultConnection({
        ...input,
        context: buildCoreRpcContext(c),
      })
  );

  function register<T, R>(
    action: string,
    bodySchema: z.ZodType<T>,
    responseSchema: z.ZodType<R>,
    execute: (
      c: Context<HonoBindings>,
      input: T & PeopleComputerTarget
    ) => Promise<R>
  ) {
    const route = `/v1/people-computers/:deviceId/lanes/:runtimeLane/projects/${action}`;
    app.post(route, async (c) => {
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      const body = await readJsonRequestBody(c.req.raw);
      const parsed = body.ok ? bodySchema.safeParse(body.value) : null;
      if (!(target.success && parsed?.success)) {
        return respondBadRequest({
          c,
          route,
          method: "POST",
          code: "invalid_payload",
          message: "Invalid computer Project request.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "POST",
        responseSchema,
        execute: () => execute(c, { ...parsed.data, ...target.data }),
      });
    });
  }
}
