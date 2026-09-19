import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_UPDATE_OBSERVATION_PATH,
  desktopUpdateObservationResponseSchema,
  desktopUpdateObservationSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

/** Native Main reporting only; not an arbitrary Inbox event-writing endpoint. */
export function registerDesktopUpdateObservationRoutes(
  app: Hono<HonoBindings>
): void {
  app.put(DESKTOP_UPDATE_OBSERVATION_PATH, async (c) => {
    const reject = (reason: string) =>
      respondBadRequest({
        c,
        route: DESKTOP_UPDATE_OBSERVATION_PATH,
        method: "PUT",
        reason,
        message: reason,
      });
    if (
      c.req.header("origin") !== DESKTOP_APP_ORIGIN ||
      c.var.authClaims.authMethod !== "session"
    ) {
      return reject(
        "Desktop update observations require the authenticated native Desktop transport."
      );
    }
    const body = await readJsonRequestBody(c.req.raw, { maxBytes: 4096 });
    if (!body.ok) {
      return reject(body.message);
    }
    const parsed = desktopUpdateObservationSchema.safeParse(body.value);
    if (!parsed.success) {
      return reject("Desktop update observation is invalid.");
    }
    return executeRpcRoute({
      c,
      route: DESKTOP_UPDATE_OBSERVATION_PATH,
      method: "PUT",
      responseSchema: desktopUpdateObservationResponseSchema,
      execute: () =>
        c.var.coreRpc.reportDesktopUpdateObservation({
          context: buildCoreRpcContext(c),
          observation: parsed.data,
        }),
    });
  });
}
