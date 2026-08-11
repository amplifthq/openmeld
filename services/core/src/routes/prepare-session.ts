import { prepareOpaqueTokenSchema } from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import { type HonoBindings, localStateDb } from "../lib/bindings";
import {
  PrepareSessionNotFoundError,
  PrepareSessionTokenInvalidError,
  readPrepareSessionSnapshotUseCase,
  resolvePrepareSessionTokenUseCase,
} from "../prepare-session/application/prepare-session-service";
import { resolvePrepareSessionHubShard } from "../prepare-session/infrastructure/prepare-session-hub-shard";
import {
  PREPARE_SESSION_HUB_ROLE_HEADER,
  PREPARE_SESSION_HUB_SESSION_ID_HEADER,
} from "../prepare-session/infrastructure/prepare-session-hub-socket-attachment";
import { readResolvedOpenMeldContext } from "../shared/context/openmeld-context";

const PREPARE_TOKEN_HEADER = "x-openmeld-prepare-token";

export function registerPrepareSessionRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/prepare/sessions/:prepareSessionId/stream", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.json(
        {
          ok: false,
          code: "bad_request",
          message: "expected websocket",
        },
        400
      );
    }

    const prepareSessionId = String(
      c.req.param("prepareSessionId") ?? ""
    ).trim();
    if (!prepareSessionId) {
      return c.json(
        {
          ok: false,
          code: "invalid_payload",
          message: "invalid prepare session id",
        },
        400
      );
    }

    const role = c.req.query("role");
    if (role === "web") {
      const authResult = await authorizeWebJoin(c, prepareSessionId);
      if (!authResult.ok) {
        return authResult.response;
      }
      return fetchPrepareSessionHub(c, {
        prepareSessionId,
        role,
      });
    }

    if (role === "terminal") {
      const terminalResult = await authorizeTerminalJoin(c, prepareSessionId);
      if (!terminalResult.ok) {
        return terminalResult.response;
      }
      return fetchPrepareSessionHub(c, {
        prepareSessionId,
        role,
      });
    }

    return c.json(
      {
        ok: false,
        code: "invalid_payload",
        message: "invalid prepare session stream role",
      },
      400
    );
  });
}

type AuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      response: Response;
    };

async function authorizeWebJoin(
  c: Context<HonoBindings>,
  prepareSessionId: string
): Promise<AuthorizationResult> {
  const fallbackRequestId =
    c.req.header("x-openmeld-request-id") ??
    c.req.header("x-request-id") ??
    crypto.randomUUID();
  const resolved = readResolvedOpenMeldContext(
    c.req.raw.headers,
    fallbackRequestId
  );
  if (!resolved.ok) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: resolved.message,
          requestId: resolved.requestId,
        },
        401
      ),
    };
  }

  const ownerUserId = String(
    resolved.context.actorContext.ownerUserId ?? ""
  ).trim();
  if (!ownerUserId) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: resolved.context.actorContext.requestId,
        },
        401
      ),
    };
  }

  const snapshot = await readPrepareSessionSnapshotUseCase({
    db: requireDb(c),
    prepareSessionId,
  }).catch((error) => {
    if (error instanceof PrepareSessionNotFoundError) {
      return null;
    }
    throw error;
  });
  if (!snapshot || snapshot.ownerUserId !== ownerUserId) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "prepare.session.not_found",
          message: "prepare session not found",
          requestId: resolved.context.actorContext.requestId,
        },
        404
      ),
    };
  }

  return { ok: true };
}

async function authorizeTerminalJoin(
  c: Context<HonoBindings>,
  prepareSessionId: string
): Promise<AuthorizationResult> {
  const parsed = prepareOpaqueTokenSchema.safeParse(
    c.req.header(PREPARE_TOKEN_HEADER)
  );
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "prepare.session.token_invalid",
          message: "missing or invalid prepare session token",
        },
        401
      ),
    };
  }

  const snapshot = await resolvePrepareSessionTokenUseCase({
    db: requireDb(c),
    opaqueToken: parsed.data,
  }).catch((error) => {
    if (error instanceof PrepareSessionTokenInvalidError) {
      return null;
    }
    throw error;
  });
  if (!snapshot || snapshot.prepareSessionId !== prepareSessionId) {
    return {
      ok: false,
      response: c.json(
        {
          ok: false,
          code: "prepare.session.token_invalid",
          message: "prepare session token does not match this session",
        },
        401
      ),
    };
  }

  return { ok: true };
}

function fetchPrepareSessionHub(
  c: Context<HonoBindings>,
  input: {
    prepareSessionId: string;
    role: "terminal" | "web";
  }
): Promise<Response> {
  const shard = resolvePrepareSessionHubShard(c.env, input.prepareSessionId);
  const request = new Request("https://prepare-session-hub.internal/stream", {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      [PREPARE_SESSION_HUB_SESSION_ID_HEADER]: input.prepareSessionId,
      [PREPARE_SESSION_HUB_ROLE_HEADER]: input.role,
    },
  });
  return shard.fetch(request);
}

function requireDb(c: Context<HonoBindings>): D1Database {
  const db = localStateDb(c.env);
  if (!db) {
    throw new Error("prepare session store unavailable");
  }
  return db;
}
