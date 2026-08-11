import { buildSignalIndex } from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { parseEnvelope } from "../protocol/wire";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { outJsonLine } from "../ui/io";
import { createCliSpaceApi } from "./cli-space-api";
import { buildFormalSignalReadPayload } from "./read-projection/formal-message-read-output";
import {
  buildIdentityOnlyMembersSnapshotForReadProjection,
  loadSpaceIdentityDirectoryOrNull,
} from "./read-projection/space-read-projection-context";
import {
  buildHumanReadSignalsTranscriptItems,
  emitHumanReadSignalsTextProjection,
} from "./read-signals-output";

// Read one thread's nested replies. Human view renders a transcript; agent view
// emits one structured `space.thread` envelope with formal per-signal payloads.
// Backend untouched — wired over the existing listThreadSignals API.
export async function runSpaceThread(input: {
  profile?: string;
  openMeldProfile?: OpenMeldProfile;
  baseUrl?: string;
  space: string;
  threadId: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const openMeldProfile =
    input.openMeldProfile ??
    (await requireOpenMeldProfile({
      openMeldProfileId: input.profile,
      persistSelection: false,
      authAction: "viewing space thread",
    }));
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const spaceApi = createCliSpaceApi(baseUrl);
  const space = input.space.trim();
  const threadId = input.threadId.trim();
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const response = await spaceApi.listThreadSignals({
    spaceId: space,
    threadId,
    requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });
  const envelopes = response.signals.flatMap((item: unknown) => {
    const env = parseEnvelope(item);
    return env ? [env] : [];
  });
  const identityDirectory = await loadSpaceIdentityDirectoryOrNull({
    spaceApi,
    spaceId: space,
    requestContext,
    resolvedPassword: input.password,
  });
  const signalIndex = buildSignalIndex(envelopes);

  if (runtime.resolvedView === "agent") {
    outJsonLine({
      type: "space.thread",
      spaceId: space,
      threadId,
      signalCount: envelopes.length,
      signals: envelopes.map((env) =>
        buildFormalSignalReadPayload({
          signal: env,
          identityDirectory,
          signalIndex,
        })
      ),
    });
    return;
  }

  const membersSnapshot =
    buildIdentityOnlyMembersSnapshotForReadProjection(identityDirectory);
  const transcriptItems = buildHumanReadSignalsTranscriptItems({
    openMeldProfile,
    events: envelopes,
    membersSnapshot,
    signalIndex,
  });
  emitHumanReadSignalsTextProjection({
    openMeldProfile,
    presenter,
    transcriptItems,
    membersSnapshot,
  });
}
