import {
  peopleComputerTargetSchema,
  serviceConnectionIncidentReceiptSchema,
  serviceConnectionIncidentReportSchema,
  serviceConnectionIncidentsResponseSchema,
} from "@openmeld/schemas";
import type {
  PeopleComputerTarget,
  ServiceConnectionIncidentReport,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export function createServiceConnectionEvidenceApi(
  client: OpenMeldApiClientFoundation
) {
  const route = (input: PeopleComputerTarget) => {
    const target = peopleComputerTargetSchema.parse(input);
    return `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/connection-incidents`;
  };
  return {
    read: async (target: PeopleComputerTarget) =>
      await client.requestJson({
        method: "GET",
        operation: "computer.connection-incidents.read",
        url: route(target),
        schema: serviceConnectionIncidentsResponseSchema,
        invalidMessage: "Invalid connection history response.",
      }),
    report: async (input: ServiceConnectionIncidentReport) =>
      await client.requestJson({
        method: "POST",
        operation: "computer.connection-incidents.report",
        url: route({
          deviceId: input.incident.deviceId,
          runtimeLane: input.incident.runtimeLane,
        }),
        body: JSON.stringify(
          serviceConnectionIncidentReportSchema.parse(input)
        ),
        headers: { "content-type": "application/json" },
        schema: serviceConnectionIncidentReceiptSchema,
        timeoutMs: 10_000,
        invalidMessage: "Invalid connection history receipt.",
      }),
  };
}
