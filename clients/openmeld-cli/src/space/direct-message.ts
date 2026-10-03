import { randomUUID } from "node:crypto";
import { createDirectMessageApi } from "@openmeld/api-client";
import { openDirectMessageSpaceBodySchema } from "@openmeld/schemas";
import type { OpenDirectMessageSpaceBody } from "@openmeld/schemas/types";
import { buildPublicSpaceEntryPath } from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { resolveRuntimeContext } from "../runtime/context";
import { readDispatchOwnedRuntimeGuard } from "../runtime/dispatch-owned-runtime";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "./api-client-foundation";
import { createCliSpaceApi } from "./cli-space-api";
import { resolveSpaceSendText } from "./send-input";

/** Non-final collaboration shared by the CLI and every dispatch tool carrier. */
export async function openDirectMessage(input: {
  request: OpenDirectMessageSpaceBody;
  profile?: string;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const request = openDirectMessageSpaceBodySchema.parse(input.request);
  const env = input.env ?? process.env;
  const dispatch = readDispatchOwnedRuntimeGuard(env).active
    ? readDispatchSpaceActionContextFromEnv(env)
    : null;
  if (dispatch && input.profile && input.profile !== dispatch.targetProfileId) {
    throw new Error("The selected profile must match this Wake’s Local Agent.");
  }
  const profile = await requireOpenMeldProfile({
    openMeldProfileId: dispatch?.targetProfileId ?? input.profile,
    persistSelection: false,
    authAction: "opening a Direct Message",
  });
  if (
    dispatch &&
    (profile.profileKind !== "agent" ||
      profile.openMeldProfileId !== dispatch.targetProfileId)
  ) {
    throw new Error(
      "The Direct Message sender does not match this Wake’s Local Agent."
    );
  }
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: profile,
  });
  // Bind collaboration to the source organization if the account switches
  // its selected organization while this Agent is working.
  const source = dispatch
    ? await createCliSpaceApi(baseUrl).resolveEntry({
        spaceId: dispatch.spaceId,
        requestContext,
      })
    : null;
  if (
    source &&
    (source.view.state !== "allowed" ||
      source.participation.state !== "active_member" ||
      !source.safeContext.organizationId)
  ) {
    throw new Error(
      "This Agent no longer has access to the Wake’s source conversation."
    );
  }
  const api = createDirectMessageApi(
    createCliApiClientFoundation(baseUrl, {
      expectedOwnerUserId: profile.ownerUserId,
      ...(source ? { organizationId: source.safeContext.organizationId } : {}),
    })
  );
  if (dispatch) {
    const current = readDispatchSpaceActionContextFromEnv(env);
    if (
      current.contextId !== dispatch.contextId ||
      current.nonce !== dispatch.nonce
    ) {
      throw new Error(
        "The Wake changed before the Direct Message could be sent."
      );
    }
  }
  const response = await api.openSpace({ ...request, requestContext });
  return {
    ...response,
    path: buildPublicSpaceEntryPath({ spaceId: response.spaceId }),
  };
}

export async function runDirectMessage(input: {
  targetProfileId: string;
  text: string;
  stdin?: boolean;
  textFile?: string;
  profile?: string;
  baseUrl?: string;
  creationId?: string;
  clientMessageId?: string;
  wake?: boolean;
  view?: string;
}) {
  const text = await resolveSpaceSendText({
    text: input.text,
    stdin: input.stdin,
    file: input.textFile,
    allowEmpty: true,
  });
  if (input.wake && !text.trim()) {
    throw new Error("Include a message describing the work to start.");
  }
  const response = await openDirectMessage({
    profile: input.profile,
    baseUrl: input.baseUrl,
    request: {
      targetProfileId: input.targetProfileId,
      ...(input.creationId ? { creationId: input.creationId } : {}),
      ...(text.trim()
        ? {
            message: {
              text,
              clientMessageId: input.clientMessageId ?? randomUUID(),
              wake: input.wake === true,
            },
          }
        : {}),
    },
  });
  const presenter = createPresenter(
    await resolveRuntimeContext({ view: input.view })
  );
  presenter.data({ code: "direct_message.opened", payload: response });
}
