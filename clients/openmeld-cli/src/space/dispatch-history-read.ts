import {
  dispatchSpaceHistoryResultSchema,
  signalTextEnvelopeSchema,
  spaceMessageEvidenceRequestSchema,
  spaceThreadEvidenceRequestSchema,
  spaceThreadEvidenceResponseSchema,
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
export async function readDispatchSpaceHistory(
  env: NodeJS.ProcessEnv = process.env
) {
  const { context, result } = await readDispatchSignals(
    env,
    (sourceSignalId) => ({
      aroundSignalId: sourceSignalId,
      beforeCount: 20,
      afterCount: 0,
      kinds: ["text"],
    })
  );
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
  return { ...output, signals };
}

export async function readDispatchSpaceEvidence(
  input: ReturnType<typeof spaceMessageEvidenceRequestSchema.parse>,
  env: NodeJS.ProcessEnv = process.env
) {
  const request = spaceMessageEvidenceRequestSchema.parse(input);
  const { context, result } = await readDispatchSignals(env, () => ({
    aroundSignalId: request.sourceSignalId,
    beforeCount: 0,
    afterCount: 0,
    kinds: ["text"],
  }));
  const signal = result.signals.find(
    (candidate) => candidate.id === request.sourceSignalId
  );
  if (!signal || signal.type !== "signal.text") {
    throw new Error(
      "space.evidence_unavailable: The requested message is unavailable."
    );
  }
  return await buildSpaceMessageEvidence({
    ...request,
    spaceId: context.spaceId,
    signal: signalTextEnvelopeSchema.parse(signal),
  });
}

async function readDispatchSignals(
  env: NodeJS.ProcessEnv,
  query: (
    sourceSignalId: string
  ) => Parameters<SpaceApi["listSignals"]>[0]["query"]
) {
  return await readDispatchSource(
    env,
    async ({ api, context, requestContext }) => {
      const result = await api.listSignals({
        spaceId: context.spaceId,
        requestContext,
        query: query(context.sourceEventId),
      });
      const signals = result.signals.map((signal) =>
        signalTextEnvelopeSchema.parse(signal)
      );
      if (signals.some((signal) => signal.spaceId !== context.spaceId)) {
        throw new Error(
          "The Space history response does not match the current Space."
        );
      }
      return { ...result, signals };
    }
  );
}

export async function readDispatchSpaceThreadEvidence(
  value: ReturnType<typeof spaceThreadEvidenceRequestSchema.parse>,
  env: NodeJS.ProcessEnv = process.env
) {
  const input = spaceThreadEvidenceRequestSchema.parse(value);
  const { result } = await readDispatchSource(
    env,
    async ({ api, context, requestContext }) => {
      const selection = {
        spaceId: context.spaceId,
        requestContext,
        threadId: input.threadId,
      };
      const thread = await api.getThread(selection);
      if (
        thread.thread.spaceId !== context.spaceId ||
        thread.thread.threadId !== input.threadId
      ) {
        throw new Error("space.evidence_source_mismatch");
      }
      const page = await api.listThreadSignals(selection);
      if (
        page.placements.some(
          (placement) => placement.threadId !== input.threadId
        )
      ) {
        throw new Error("space.evidence_source_mismatch");
      }
      return await buildSpaceThreadEvidence({
        ...input,
        thread: thread.thread,
        signals: page.signals,
      });
    }
  );
  return spaceThreadEvidenceResponseSchema.parse(result);
}

async function readDispatchSource<T>(
  env: NodeJS.ProcessEnv,
  read: (input: {
    api: SpaceApi;
    context: ReturnType<typeof readDispatchSpaceActionContextFromEnv>;
    requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  }) => Promise<T>
) {
  if (env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] !== DISPATCH_OWNED_RUNTIME_MODE) {
    throw new Error(
      "Space history tools require an active OpenMeld dispatch runtime."
    );
  }
  const context = readDispatchSpaceActionContextFromEnv(env);
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
  const result = await read({
    api: createCliSpaceApi(await resolveBaseUrl()),
    context,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: profile,
    }),
  });
  const current = readDispatchSpaceActionContextFromEnv(env);
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
  return { context, result };
}

import type { SpaceApi } from "@openmeld/api-client";
import {
  buildSpaceMessageEvidence,
  buildSpaceThreadEvidence,
} from "@openmeld/protocol";
