import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  daemonRouteObservationResponseSchema,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_REASONING_STREAM_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
  SERVICE_CONNECTION_ID_QUERY_PARAMETER,
  serviceConnectionDiagnosticIdSchema,
} from "@openmeld/schemas";
import type {
  DaemonRouteObservationResponse,
  RuntimeTransportLookupRouteResponse,
} from "@openmeld/schemas/types";
import type { Hono } from "hono";
import { lookupRuntimeTransportRoute } from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { resolveRuntimeTransportOwnerShard } from "../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { HonoBindings } from "../lib/bindings";
import { RUNTIME_TRANSPORT_VERIFIED_OWNER_HEADER } from "../runtime-transport/infrastructure/runtime-transport-socket-attachment";

export function registerDaemonRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/daemon/routes/:profileId", async (c) => {
    const actorContext = c.var.openMeldRequestContext.actorContext;
    const ownerUserId = String(actorContext.ownerUserId ?? "").trim();
    if (!ownerUserId) {
      return c.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: actorContext.requestId,
        },
        401
      );
    }

    const profileId = String(c.req.param("profileId") ?? "").trim();
    if (!profileId) {
      return c.json(
        {
          ok: false,
          code: "invalid_profile_id",
          message: "profile id is invalid",
          requestId: actorContext.requestId,
        },
        400
      );
    }

    const route = await lookupRuntimeTransportRoute({
      blockForgottenDevices: true,
      env: c.env,
      ownerUserId,
      profileId,
    });
    const publicRoute = toPublicDaemonRouteObservationRoute(route);
    const parsed = daemonRouteObservationResponseSchema.safeParse({
      observedAt: new Date().toISOString(),
      profileId,
      route: publicRoute,
    });
    if (!parsed.success) {
      throw new Error("invalid daemon route observation response");
    }

    return c.json(parsed.data);
  });

  app.get("/v1/daemon/stream", async (c) => {
    const actorContext = c.var.openMeldRequestContext.actorContext;
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.json(
        {
          ok: false,
          code: "bad_request",
          message: "expected websocket",
          requestId: actorContext.requestId,
        },
        400
      );
    }

    const ownerUserId = String(actorContext.ownerUserId ?? "").trim();
    if (!ownerUserId) {
      return c.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: actorContext.requestId,
        },
        401
      );
    }

    const shard = resolveRuntimeTransportOwnerShard(c.env, ownerUserId);
    const computerFileAccessCapability =
      c.req.header(OPENMELD_RUNTIME_CAPABILITIES_HEADER) ===
      COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
        ? COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY
        : null;
    const localFolderPickerCapability =
      c.req.header(OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER) ===
      LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
        ? LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY
        : null;
    const shardUrl = new URL("https://runtime-transport.internal/stream");
    const connectionId = serviceConnectionDiagnosticIdSchema.safeParse(
      c.req.query(SERVICE_CONNECTION_ID_QUERY_PARAMETER)
    );
    if (connectionId.success) {
      shardUrl.searchParams.set(
        SERVICE_CONNECTION_ID_QUERY_PARAMETER,
        connectionId.data
      );
    }
    const shardRequest = new Request(shardUrl, {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        ...(c.req.header(OPENMELD_REASONING_STREAM_HEADER) === "1"
          ? { [OPENMELD_REASONING_STREAM_HEADER]: "1" }
          : {}),
        [RUNTIME_TRANSPORT_VERIFIED_OWNER_HEADER]: ownerUserId,
        ...(computerFileAccessCapability
          ? {
              [OPENMELD_RUNTIME_CAPABILITIES_HEADER]:
                computerFileAccessCapability,
            }
          : {}),
        ...(localFolderPickerCapability
          ? {
              [OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER]:
                localFolderPickerCapability,
            }
          : {}),
      },
    });

    return await shard.fetch(shardRequest);
  });
}

export function toPublicDaemonRouteObservationRoute(
  route: RuntimeTransportLookupRouteResponse
): DaemonRouteObservationResponse["route"] {
  if (route.online) {
    return {
      online: true,
      daemonSessionId: route.daemonSessionId,
      deviceId: route.deviceId,
      lane: route.lane,
      serviceVersion: route.serviceVersion,
      connectionGeneration: route.connectionGeneration,
      leaseEpoch: route.leaseEpoch,
      lastHeartbeatMs: route.lastHeartbeatMs,
      capabilities: route.capabilities,
      executionCompatibility: route.executionCompatibility,
      localWakeRouteReport: route.localWakeRouteReport,
    };
  }

  return {
    online: false,
    // Compatibility shim: remove after the published CLI floor accepts
    // daemon.profile.pending_first_report on this public observation route.
    reasonCode:
      route.reasonCode === "daemon.profile.pending_first_report"
        ? "daemon.profile.offline"
        : route.reasonCode,
    ...(route.lastHeartbeatMs === undefined
      ? {}
      : { lastHeartbeatMs: route.lastHeartbeatMs }),
    ...(route.executionCompatibility
      ? { executionCompatibility: route.executionCompatibility }
      : {}),
    ...(route.localWakeRouteReport
      ? { localWakeRouteReport: route.localWakeRouteReport }
      : {}),
    ...(route.rejectedProfileRegistration
      ? { rejectedProfileRegistration: route.rejectedProfileRegistration }
      : {}),
  };
}
