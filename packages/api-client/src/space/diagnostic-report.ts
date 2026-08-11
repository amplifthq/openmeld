import {
  createSpaceDiagnosticReportBodySchema,
  createSpaceDiagnosticReportResponseSchema,
} from "@openmeld/schemas";
import type {
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceDiagnosticReportsPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function createSpaceDiagnosticReport(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    body: CreateSpaceDiagnosticReportBody;
  }
): Promise<CreateSpaceDiagnosticReportResponse> {
  const parsedBody = createSpaceDiagnosticReportBodySchema.safeParse(
    input.body
  );
  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0];
    throw new Error(
      firstIssue?.message ?? "invalid diagnostic report request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceDiagnosticReportsPath(input.spaceId),
    operation: "space.diagnostic_report.create",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: createSpaceDiagnosticReportResponseSchema,
    invalidMessage: "invalid diagnostic report response",
  });
}
