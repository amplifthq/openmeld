import {
  peopleComputerTargetSchema,
  serviceConnectionIncidentReceiptSchema,
  serviceConnectionIncidentReportSchema,
  serviceConnectionIncidentsResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const route =
  "/v1/people-computers/:deviceId/lanes/:runtimeLane/connection-incidents";

export function registerServiceConnectionEvidenceRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(route, (c) => {
    const target = peopleComputerTargetSchema.safeParse(c.req.param());
    if (!target.success) {
      return respondBadRequest({
        c,
        route,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid computer target.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "GET",
      responseSchema: serviceConnectionIncidentsResponseSchema,
      execute: () =>
        c.var.coreRpc.readServiceConnectionIncidents({
          ...target.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  app.post(route, async (c) => {
    const target = peopleComputerTargetSchema.safeParse(c.req.param());
    const body = await readJsonRequestBody(c.req.raw, { maxBytes: 128 * 1024 });
    const report = body.ok
      ? serviceConnectionIncidentReportSchema.safeParse(body.value)
      : null;
    if (!(target.success && report?.success)) {
      return respondBadRequest({
        c,
        route,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid connection incident.",
      });
    }
    return executeRpcRoute({
      c,
      route,
      method: "POST",
      responseSchema: serviceConnectionIncidentReceiptSchema,
      execute: () =>
        c.var.coreRpc.reportServiceConnectionIncident({
          ...target.data,
          report: report.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}
