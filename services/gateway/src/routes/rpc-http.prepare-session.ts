import {
  createPrepareSessionRequestSchema,
  prepareDiagnosticResponseSchema,
  prepareOpaqueTokenSchema,
  prepareSessionResponseSchema,
  prepareSessionWithTokenResponseSchema,
  prepareSetupBootstrapWriteSchema,
  terminalStepWriteSchema,
  webAgentSelectionWriteSchema,
} from "@openmeld/schemas";
import type { PrepareOpaqueToken } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executePublicRpcRoute,
  executeRpcRoute,
  respondBadRequest,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const PREPARE_SESSION_COLLECTION_ROUTE = "/v1/prepare/sessions";
const PREPARE_SESSION_ROUTE = "/v1/prepare/sessions/:prepareSessionId";
const PREPARE_SESSION_TOKEN_ROUTE =
  "/v1/prepare/sessions/:prepareSessionId/token";
const PREPARE_SESSION_RESOLVE_TOKEN_ROUTE =
  "/v1/prepare/sessions/resolve-token";
const PREPARE_AGENT_SELECTION_ROUTE =
  "/v1/prepare/sessions/:prepareSessionId/agent-selection";
const PREPARE_SETUP_BOOTSTRAP_ROUTE =
  "/v1/prepare/sessions/:prepareSessionId/setup-bootstrap";
const PREPARE_TERMINAL_STEP_ROUTE =
  "/v1/prepare/sessions/:prepareSessionId/terminal-step";
const PREPARE_DIAGNOSTIC_ROUTE =
  "/v1/prepare/sessions/:prepareSessionId/diagnostics";
const PREPARE_TOKEN_HEADER = "x-openmeld-prepare-token";

export function registerPrepareSessionRoutes(app: Hono<HonoBindings>): void {
  app.post(PREPARE_SESSION_COLLECTION_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PREPARE_SESSION_COLLECTION_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = createPrepareSessionRequestSchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: PREPARE_SESSION_COLLECTION_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Invalid prepare session payload",
      });
    }

    return executeRpcRoute({
      c,
      route: PREPARE_SESSION_COLLECTION_ROUTE,
      method: "POST",
      successStatus: 201,
      responseSchema: prepareSessionWithTokenResponseSchema,
      execute: async () =>
        await c.var.coreRpc.createPrepareSession({
          ...parsedBody.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(PREPARE_SESSION_ROUTE, (c) => {
    const prepareSessionId = parsePrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    return executeRpcRoute({
      c,
      route: PREPARE_SESSION_ROUTE,
      method: "GET",
      responseSchema: prepareSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getPrepareSession({
          prepareSessionId: prepareSessionId.value,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(PREPARE_SESSION_TOKEN_ROUTE, (c) => {
    const prepareSessionId = parsePrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    return executeRpcRoute({
      c,
      route: PREPARE_SESSION_TOKEN_ROUTE,
      method: "POST",
      responseSchema: prepareSessionWithTokenResponseSchema,
      execute: async () =>
        await c.var.coreRpc.mintPrepareSessionReconnectToken({
          prepareSessionId: prepareSessionId.value,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(PREPARE_SESSION_RESOLVE_TOKEN_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondPublicBadRequest({
        c,
        route: PREPARE_SESSION_RESOLVE_TOKEN_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsed = prepareOpaqueTokenSchema.safeParse(
      (bodyResult.value as { opaqueToken?: unknown }).opaqueToken
    );
    if (!parsed.success) {
      return respondPublicBadRequest({
        c,
        route: PREPARE_SESSION_RESOLVE_TOKEN_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid prepare session token",
      });
    }

    return executePublicRpcRoute({
      c,
      route: PREPARE_SESSION_RESOLVE_TOKEN_ROUTE,
      method: "POST",
      responseSchema: prepareSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.resolvePrepareSessionToken({
          opaqueToken: parsed.data,
        }),
    });
  });

  app.put(PREPARE_AGENT_SELECTION_ROUTE, async (c) => {
    const prepareSessionId = parsePrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PREPARE_AGENT_SELECTION_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsed = webAgentSelectionWriteSchema.safeParse({
      ...(bodyResult.value as Record<string, unknown>),
      prepareSessionId: prepareSessionId.value,
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: PREPARE_AGENT_SELECTION_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ?? "Invalid prepare agent selection",
      });
    }

    return executeRpcRoute({
      c,
      route: PREPARE_AGENT_SELECTION_ROUTE,
      method: "PUT",
      responseSchema: prepareSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.writePrepareAgentSelection({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.patch(PREPARE_SETUP_BOOTSTRAP_ROUTE, async (c) => {
    const prepareSessionId = parsePrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PREPARE_SETUP_BOOTSTRAP_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsed = prepareSetupBootstrapWriteSchema.safeParse({
      ...(bodyResult.value as Record<string, unknown>),
      prepareSessionId: prepareSessionId.value,
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: PREPARE_SETUP_BOOTSTRAP_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ??
          "Invalid prepare setup bootstrap result",
      });
    }

    return executeRpcRoute({
      c,
      route: PREPARE_SETUP_BOOTSTRAP_ROUTE,
      method: "PATCH",
      responseSchema: prepareSessionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.writePrepareSetupBootstrap({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(PREPARE_TERMINAL_STEP_ROUTE, async (c) => {
    const prepareSessionId = parsePublicPrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    const token = parsePrepareTokenHeader(c);
    if (!token.ok) {
      return token.response;
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondPublicBadRequest({
        c,
        route: PREPARE_TERMINAL_STEP_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsed = terminalStepWriteSchema.safeParse({
      ...(bodyResult.value as Record<string, unknown>),
      prepareSessionId: prepareSessionId.value,
    });
    if (!parsed.success) {
      return respondPublicBadRequest({
        c,
        route: PREPARE_TERMINAL_STEP_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ?? "Invalid prepare terminal step",
      });
    }

    return executePublicRpcRoute({
      c,
      route: PREPARE_TERMINAL_STEP_ROUTE,
      method: "PUT",
      responseSchema: prepareSessionResponseSchema,
      execute: async () => {
        const resolved = await c.var.coreRpc.resolvePrepareSessionToken({
          opaqueToken: token.value,
        });
        if (resolved.snapshot.prepareSessionId !== prepareSessionId.value) {
          throw createGatewayStructuredError({
            status: 400,
            code: "invalid_payload",
            message: "Prepare session token does not match this session",
          });
        }
        return await c.var.coreRpc.writePrepareTerminalStep(parsed.data);
      },
    });
  });

  app.get(PREPARE_DIAGNOSTIC_ROUTE, (c) => {
    const prepareSessionId = parsePrepareSessionId(c);
    if (!prepareSessionId.ok) {
      return prepareSessionId.response;
    }

    return executeRpcRoute({
      c,
      route: PREPARE_DIAGNOSTIC_ROUTE,
      method: "GET",
      responseSchema: prepareDiagnosticResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getPrepareDiagnostic({
          prepareSessionId: prepareSessionId.value,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}

type ParsedValue<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      response: Response;
    };

function parsePrepareSessionId(c: Context<HonoBindings>): ParsedValue<string> {
  const value = String(c.req.param("prepareSessionId") ?? "").trim();
  if (value.length > 0) {
    return { ok: true, value };
  }
  return {
    ok: false,
    response: respondBadRequest({
      c,
      route: c.req.path,
      method: c.req.method as "GET" | "POST" | "PUT" | "PATCH",
      code: "invalid_payload",
      message: "Invalid prepare session id",
    }),
  };
}

function parsePublicPrepareSessionId(
  c: Context<HonoBindings>
): ParsedValue<string> {
  const value = String(c.req.param("prepareSessionId") ?? "").trim();
  if (value.length > 0) {
    return { ok: true, value };
  }
  return {
    ok: false,
    response: respondPublicBadRequest({
      c,
      route: c.req.path,
      method: c.req.method as "GET" | "POST" | "PUT" | "PATCH",
      code: "invalid_payload",
      message: "Invalid prepare session id",
    }),
  };
}

function parsePrepareTokenHeader(
  c: Context<HonoBindings>
): ParsedValue<PrepareOpaqueToken> {
  const parsed = prepareOpaqueTokenSchema.safeParse(
    c.req.header(PREPARE_TOKEN_HEADER)
  );
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    response: respondPublicBadRequest({
      c,
      route: c.req.path,
      method: c.req.method as "GET" | "POST" | "PUT",
      code: "invalid_payload",
      message: "Missing or invalid prepare session token",
    }),
  };
}

function createGatewayStructuredError(input: {
  status: number;
  code: string;
  message: string;
}): Error {
  const error = new Error(`HTTP ${input.status}: ${input.message}`) as Error & {
    cause?: {
      code: string;
      message: string;
      status: number;
    };
  };
  error.cause = input;
  return error;
}
