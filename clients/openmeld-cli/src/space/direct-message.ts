import { randomUUID } from "node:crypto";
import { createDirectMessageApi } from "@openmeld/api-client";
import {
  openDirectMessageSpaceBodySchema,
  spaceSendRequestReceiptSchema,
} from "@openmeld/schemas";
import type {
  OpenDirectMessageSpaceBody,
  SpaceSendRequestReceipt,
} from "@openmeld/schemas/types";
import { buildPublicSpaceEntryPath } from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { resolveRuntimeContext } from "../runtime/context";
import { readDispatchOwnedRuntimeGuard } from "../runtime/dispatch-owned-runtime";
import {
  type DispatchSpaceActionContext,
  readDispatchSpaceActionContextFromEnv,
} from "../runtime/dispatch-space-action-context";
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
  onRequest?: (receipt: SpaceSendRequestReceipt) => void;
}) {
  const request = openDirectMessageSpaceBodySchema.parse(input.request);
  const env = input.env ?? process.env;
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const { profile, dispatch, requestContext, organizationId } =
    await resolveDirectMessageCaller({ profile: input.profile, baseUrl, env });
  const api = createDirectMessageApi(
    createCliApiClientFoundation(baseUrl, {
      expectedOwnerUserId: profile.ownerUserId,
      organizationId,
    })
  );
  assertCurrentDispatch(dispatch, env);
  const opened =
    request.message && !request.spaceId
      ? await api.openSpace({
          targetProfileId: request.targetProfileId,
          creationId: request.creationId,
          requestContext,
        })
      : null;
  const spaceId = request.spaceId ?? opened?.spaceId;
  if (request.message && spaceId) {
    // No work is submitted until the caller has an exact, stoppable identity.
    input.onRequest?.(
      spaceSendRequestReceiptSchema.parse({
        spaceId,
        profileId: profile.openMeldProfileId,
        clientMessageId: request.message.clientMessageId,
        targetProfileIds: request.message.wake ? [request.targetProfileId] : [],
      })
    );
    assertCurrentDispatch(dispatch, env);
  }
  const sendApi = opened
    ? createDirectMessageApi(
        createCliApiClientFoundation(baseUrl, {
          expectedOwnerUserId: profile.ownerUserId,
          organizationId: opened.organizationId,
        })
      )
    : api;
  const response = await sendApi.openSpace({
    ...request,
    ...(opened ? { creationId: undefined, spaceId: opened.spaceId } : {}),
    requestContext,
  });
  return {
    ...response,
    ...(opened
      ? { created: opened.created, creationId: opened.creationId }
      : {}),
    path: buildPublicSpaceEntryPath({ spaceId: response.spaceId }),
  };
}

async function resolveDirectMessageCaller(input: {
  profile?: string;
  baseUrl: string;
  env: NodeJS.ProcessEnv;
}) {
  const { env, baseUrl } = input;
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
  return {
    profile,
    dispatch,
    requestContext,
    organizationId: source?.safeContext.organizationId ?? undefined,
  };
}

function assertCurrentDispatch(
  dispatch: DispatchSpaceActionContext | null,
  env: NodeJS.ProcessEnv
) {
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
}

export async function runDirectMessage(input: {
  targetProfileId: string;
  text: string;
  stdin?: boolean;
  textFile?: string;
  profile?: string;
  baseUrl?: string;
  creationId?: string;
  spaceId?: string;
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
  const presenter = createPresenter(
    await resolveRuntimeContext({ view: input.view })
  );
  const response = await openDirectMessage({
    profile: input.profile,
    baseUrl: input.baseUrl,
    onRequest: (receipt) =>
      presenter.line({
        code: "space.send.request",
        text: `Request: ${receipt.clientMessageId}`,
        data: receipt,
      }),
    request: {
      targetProfileId: input.targetProfileId,
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
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
  presenter.data({ code: "direct_message.opened", payload: response });
}
