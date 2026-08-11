import {
  prepareSessionResponseSchema,
  prepareSetupBootstrapWriteSchema,
} from "@openmeld/schemas";
import type {
  PrepareSessionResponse,
  PrepareSetupBootstrapResult,
} from "@openmeld/schemas/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { resolveOpenMeldProfile } from "./openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "./openmeld-request-context";

export async function writePrepareSessionSetupBootstrapResult(input: {
  baseUrl: string;
  prepareSessionId: string;
  setupBootstrap: PrepareSetupBootstrapResult;
}): Promise<PrepareSessionResponse> {
  const write = requireValidSetupBootstrapWrite({
    prepareSessionId: input.prepareSessionId,
    setupBootstrap: input.setupBootstrap,
  });
  const humanProfile = await resolveOpenMeldProfile({ profileKind: "human" });
  return await createCliApiClientFoundation(input.baseUrl).requestJson({
    body: JSON.stringify({
      setupBootstrap: write.setupBootstrap,
    }),
    headers: {
      "content-type": "application/json",
    },
    invalidMessage: "Invalid prepare session setup bootstrap response.",
    method: "PATCH",
    operation: "prepare.session.setup_bootstrap.write",
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: humanProfile,
    }),
    schema: prepareSessionResponseSchema,
    url: buildPrepareSessionSetupBootstrapRoute(write.prepareSessionId),
  });
}

function buildPrepareSessionSetupBootstrapRoute(
  prepareSessionId: string
): string {
  return `/v1/prepare/sessions/${encodeURIComponent(
    prepareSessionId
  )}/setup-bootstrap`;
}

function requireValidSetupBootstrapWrite(input: {
  prepareSessionId: string;
  setupBootstrap: PrepareSetupBootstrapResult;
}) {
  const parsed = prepareSetupBootstrapWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid prepare session setup bootstrap result."
    );
  }
  return parsed.data;
}
