import {
  DB_FACT_SCHEMA_VERSION,
  dbDiagnosticsPayloadSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { executeRpcRoute } from "./rpc-http.helpers";

export function registerDiagnosticsRoute(app: Hono<HonoBindings>): void {
  app.get("/v1/diagnostics/chain", async (c) => {
    return await executeRpcRoute({
      c,
      route: "/v1/diagnostics/chain",
      method: "GET",
      execute: async () => {
        const [auth, core, authDbState, coreDbState, dispatchStorageReadiness] =
          await Promise.all([
            c.var.authRpc.ping(),
            c.var.coreRpc.ping(),
            c.var.authRpc.inspectDbState(),
            c.var.coreRpc.inspectDbState(),
            c.var.coreRpc.inspectDispatchStorageReadiness(),
          ]);
        if (!dispatchStorageReadiness.ready) {
          const message = `Core dispatch storage is not ready: ${dispatchStorageReadiness.detail ?? "unknown storage readiness error"}`;
          throw new Error(message, {
            cause: {
              status: 503,
              code: "upstream_unreachable",
              message,
            },
          });
        }
        const db = dbDiagnosticsPayloadSchema.parse({
          contractVersion: DB_FACT_SCHEMA_VERSION,
          auth: authDbState,
          core: coreDbState,
        });
        return {
          ok: true,
          service: "openmeld-gateway",
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          profile: {
            profileId: c.var.resolvedProfile.openMeldProfileId,
            profileKind: c.var.resolvedProfile.profileKind,
            profileName: c.var.resolvedProfile.profileName,
          },
          auth,
          core,
          db,
        };
      },
    });
  });
}
