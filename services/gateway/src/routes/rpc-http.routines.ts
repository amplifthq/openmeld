import {
  CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT,
  CENTER_AGENT_ROUTINE_MANAGEMENT_V1_CONTRACT,
  centerAgentRoutineContractQuerySchema,
  centerAgentRoutineMutationLegacyV1ResponseSchema,
  centerAgentRoutineRouteParamsSchema,
  createCenterAgentRoutineBodySchema,
  createCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineBodySchema,
  deleteCenterAgentRoutineResponseSchema,
  listCenterAgentRoutineRunsLegacyV1ResponseSchema,
  listCenterAgentRoutineRunsQuerySchema,
  listCenterAgentRoutineRunsResponseSchema,
  listCenterAgentRoutinesLegacyV1ResponseSchema,
  listCenterAgentRoutinesManagementResponseSchema,
  listCenterAgentRoutinesManagementV1ResponseSchema,
  listCenterAgentRoutinesQuerySchema,
  listCenterAgentRoutinesResponseSchema,
  listCenterAgentRoutineTargetSpacesQuerySchema,
  listCenterAgentRoutineTargetSpacesResponseSchema,
  pauseCenterAgentRoutineBodySchema,
  pauseCenterAgentRoutineResponseSchema,
  resumeCenterAgentRoutineBodySchema,
  resumeCenterAgentRoutineResponseSchema,
  updateCenterAgentRoutineBodySchema,
  updateCenterAgentRoutineResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const ROUTINES_ROUTE = "/v1/organizations/current/routines";
const ROUTINE_TARGET_SPACES_ROUTE =
  "/v1/organizations/current/routine-target-spaces";
const ROUTINE_ROUTE = `${ROUTINES_ROUTE}/:routineId`;
const ROUTINE_PAUSE_ROUTE = `${ROUTINE_ROUTE}/pause`;
const ROUTINE_RESUME_ROUTE = `${ROUTINE_ROUTE}/resume`;
const ROUTINE_RUNS_ROUTE = `${ROUTINE_ROUTE}/runs`;

export function registerRoutineRoutes(app: Hono<HonoBindings>): void {
  app.get(ROUTINE_TARGET_SPACES_ROUTE, (c) => {
    const query = listCenterAgentRoutineTargetSpacesQuerySchema.safeParse(
      c.req.query()
    );
    if (!query.success) {
      return invalidPayloadResponse(
        c,
        ROUTINE_TARGET_SPACES_ROUTE,
        "GET",
        query.error
      );
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listRoutineTargetSpaces({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: listCenterAgentRoutineTargetSpacesResponseSchema,
      route: ROUTINE_TARGET_SPACES_ROUTE,
    });
  });

  app.get(ROUTINES_ROUTE, (c) => {
    const query = listCenterAgentRoutinesQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(c, ROUTINES_ROUTE, "GET", query.error);
    }
    let responseSchema: z.ZodType<unknown> =
      listCenterAgentRoutinesLegacyV1ResponseSchema;
    if (query.data.contract === CENTER_AGENT_ROUTINE_MANAGEMENT_CONTRACT) {
      responseSchema = listCenterAgentRoutinesManagementResponseSchema;
    } else if (
      query.data.contract === CENTER_AGENT_ROUTINE_MANAGEMENT_V1_CONTRACT
    ) {
      responseSchema = listCenterAgentRoutinesManagementV1ResponseSchema;
    } else if (query.data.contract) {
      responseSchema = listCenterAgentRoutinesResponseSchema;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listRoutines({
          context: buildCoreRpcContext(c),
          ...(query.data.contract ? { contract: query.data.contract } : {}),
        }),
      method: "GET",
      responseSchema,
      route: ROUTINES_ROUTE,
    });
  });

  app.post(ROUTINES_ROUTE, async (c) => {
    const contract = parseRoutineContractQuery(c, ROUTINES_ROUTE, "POST");
    if (!contract.ok) {
      return contract.response;
    }
    const body = await parseRoutineBody(
      c,
      ROUTINES_ROUTE,
      "POST",
      createCenterAgentRoutineBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createRoutine({
          ...body.data,
          context: buildCoreRpcContext(c),
          ...(contract.data.contract
            ? { contract: contract.data.contract }
            : {}),
        }),
      method: "POST",
      responseSchema: contract.data.contract
        ? createCenterAgentRoutineResponseSchema
        : centerAgentRoutineMutationLegacyV1ResponseSchema,
      route: ROUTINES_ROUTE,
      successStatus: 201,
    });
  });

  app.patch(ROUTINE_ROUTE, async (c) => {
    const contract = parseRoutineContractQuery(c, ROUTINE_ROUTE, "PATCH");
    if (!contract.ok) {
      return contract.response;
    }
    const params = parseRoutineParams(c, ROUTINE_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseRoutineBody(
      c,
      ROUTINE_ROUTE,
      "PATCH",
      updateCenterAgentRoutineBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateRoutine({
          ...body.data,
          context: buildCoreRpcContext(c),
          ...(contract.data.contract
            ? { contract: contract.data.contract }
            : {}),
          routineId: params.data.routineId,
        }),
      method: "PATCH",
      responseSchema: contract.data.contract
        ? updateCenterAgentRoutineResponseSchema
        : centerAgentRoutineMutationLegacyV1ResponseSchema,
      route: ROUTINE_ROUTE,
    });
  });

  app.post(ROUTINE_PAUSE_ROUTE, async (c) => {
    const contract = parseRoutineContractQuery(c, ROUTINE_PAUSE_ROUTE, "POST");
    if (!contract.ok) {
      return contract.response;
    }
    const params = parseRoutineParams(c, ROUTINE_PAUSE_ROUTE, "POST");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseRoutineBody(
      c,
      ROUTINE_PAUSE_ROUTE,
      "POST",
      pauseCenterAgentRoutineBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.pauseRoutine({
          context: buildCoreRpcContext(c),
          ...(contract.data.contract
            ? { contract: contract.data.contract }
            : {}),
          routineId: params.data.routineId,
        }),
      method: "POST",
      responseSchema: contract.data.contract
        ? pauseCenterAgentRoutineResponseSchema
        : centerAgentRoutineMutationLegacyV1ResponseSchema,
      route: ROUTINE_PAUSE_ROUTE,
    });
  });

  app.post(ROUTINE_RESUME_ROUTE, async (c) => {
    const contract = parseRoutineContractQuery(c, ROUTINE_RESUME_ROUTE, "POST");
    if (!contract.ok) {
      return contract.response;
    }
    const params = parseRoutineParams(c, ROUTINE_RESUME_ROUTE, "POST");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseRoutineBody(
      c,
      ROUTINE_RESUME_ROUTE,
      "POST",
      resumeCenterAgentRoutineBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.resumeRoutine({
          context: buildCoreRpcContext(c),
          ...(contract.data.contract
            ? { contract: contract.data.contract }
            : {}),
          routineId: params.data.routineId,
        }),
      method: "POST",
      responseSchema: contract.data.contract
        ? resumeCenterAgentRoutineResponseSchema
        : centerAgentRoutineMutationLegacyV1ResponseSchema,
      route: ROUTINE_RESUME_ROUTE,
    });
  });

  app.delete(ROUTINE_ROUTE, async (c) => {
    const contract = parseRoutineContractQuery(c, ROUTINE_ROUTE, "DELETE");
    if (!contract.ok) {
      return contract.response;
    }
    const params = parseRoutineParams(c, ROUTINE_ROUTE, "DELETE");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseRoutineBody(
      c,
      ROUTINE_ROUTE,
      "DELETE",
      deleteCenterAgentRoutineBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.deleteRoutine({
          context: buildCoreRpcContext(c),
          ...(contract.data.contract
            ? { contract: contract.data.contract }
            : {}),
          routineId: params.data.routineId,
        }),
      method: "DELETE",
      responseSchema: deleteCenterAgentRoutineResponseSchema,
      route: ROUTINE_ROUTE,
    });
  });

  app.get(ROUTINE_RUNS_ROUTE, (c) => {
    const params = parseRoutineParams(c, ROUTINE_RUNS_ROUTE, "GET");
    if (!params.ok) {
      return params.response;
    }
    const query = listCenterAgentRoutineRunsQuerySchema.safeParse(
      c.req.query()
    );
    if (!query.success) {
      return invalidPayloadResponse(c, ROUTINE_RUNS_ROUTE, "GET", query.error);
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listRoutineRuns({
          ...query.data,
          context: buildCoreRpcContext(c),
          routineId: params.data.routineId,
        }),
      method: "GET",
      responseSchema: query.data.contract
        ? listCenterAgentRoutineRunsResponseSchema
        : listCenterAgentRoutineRunsLegacyV1ResponseSchema,
      route: ROUTINE_RUNS_ROUTE,
    });
  });
}

type ParseResult<T> = { data: T; ok: true } | { ok: false; response: Response };

function parseRoutineContractQuery(
  c: Context<HonoBindings>,
  route: string,
  method: "DELETE" | "PATCH" | "POST"
): ParseResult<{ contract?: "practical-v2" }> {
  const parsed = centerAgentRoutineContractQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

async function parseRoutineBody<T>(
  c: Context<HonoBindings>,
  route: string,
  method: "DELETE" | "PATCH" | "POST",
  schema: z.ZodType<T>,
  acceptMissingBody = false
): Promise<ParseResult<T>> {
  const body = await readJsonRequestBody(c.req.raw);
  if (!body.ok) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method,
        route,
      }),
    };
  }
  const value = acceptMissingBody && body.value === undefined ? {} : body.value;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function parseRoutineParams(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<{ routineId: string }> {
  const parsed = centerAgentRoutineRouteParamsSchema.safeParse({
    routineId: c.req.param("routineId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function invalidPayloadResponse(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  error: z.ZodError
): Response {
  return respondBadRequest({
    c,
    code: "invalid_payload",
    message: error.issues[0]?.message ?? "Invalid Routine request.",
    method,
    route,
  });
}
