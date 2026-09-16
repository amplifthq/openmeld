import {
  dispatchSpaceHistoryResultSchema,
  signalTextEnvelopeSchema,
} from "@openmeld/schemas";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../runtime/dispatch-runtime-env";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import { createCliSpaceApi } from "./cli-space-api";

/** Read the current Wake's bounded Space history through the existing member API. */
export async function readDispatchSpaceHistory() {
  if (
    process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] !==
    DISPATCH_OWNED_RUNTIME_MODE
  ) {
    throw new Error(
      "Space history tools require an active OpenMeld dispatch runtime."
    );
  }
  const context = readDispatchSpaceActionContextFromEnv();
  const profile = await requireOpenMeldProfile({
    openMeldProfileId: context.targetProfileId,
    persistSelection: false,
    authAction: "reading the current Wake's Space history",
  });
  if (
    profile.openMeldProfileId !== context.targetProfileId ||
    profile.profileKind !== "agent"
  ) {
    throw new Error(
      "The Space history reader does not match the current Agent."
    );
  }
  const result = await createCliSpaceApi(await resolveBaseUrl()).listSignals({
    spaceId: context.spaceId,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
    query: {
      aroundSignalId: context.sourceEventId,
      beforeCount: 20,
      afterCount: 0,
      kinds: ["text"],
    },
  });
  const current = readDispatchSpaceActionContextFromEnv();
  if (
    current.contextId !== context.contextId ||
    current.nonce !== context.nonce ||
    current.spaceId !== context.spaceId ||
    current.sourceEventId !== context.sourceEventId ||
    current.targetProfileId !== context.targetProfileId
  ) {
    throw new Error(
      "The dispatch context changed during the Space history read."
    );
  }
  const output = dispatchSpaceHistoryResultSchema.parse({
    spaceId: context.spaceId,
    sourceSignalId: context.sourceEventId,
    beforeCount: 20,
    afterCount: 0,
    signals: result.signals,
    nextCursor: result.nextCursor,
  });
  const signals = output.signals.map((signal) =>
    signalTextEnvelopeSchema.parse(signal)
  );
  if (signals.some((signal) => signal.spaceId !== context.spaceId)) {
    throw new Error(
      "The Space history response does not match the current Space."
    );
  }
  return { ...output, signals };
}
