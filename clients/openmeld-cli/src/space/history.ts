import type { SignalEnvelope, SpaceMeta } from "@openmeld/protocol";
import type {
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildSignalIndex,
  buildSignalMessageReadProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { toSpaceMetaUrl } from "../protocol/urls";
import { parseEnvelope } from "../protocol/wire";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { outJsonLine } from "../ui/io";
import { formatTextEvent } from "../ui/output";
import {
  buildAgentSessionMetaPayload,
  normalizeAgentOutputEvent,
} from "./agent-output-contract";
import { createCliSpaceApi, type SpaceSignalsReadQuery } from "./cli-space-api";
import { assertFullSignalIdArgument } from "./command-context";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { resolveMembersSearchableActiveItemId } from "./panel/space-panel-content";
import {
  buildFormalSignalReadPayload,
  type SpaceSignalThreadReplyPreview,
  type SpaceSignalThreadSummary,
} from "./read-projection/formal-message-read-output";
import {
  buildIdentityOnlyMembersSnapshotForReadProjection,
  loadSpaceIdentityDirectoryOrNull,
  loadSpaceSignalIndexOrNull,
} from "./read-projection/space-read-projection-context";
import {
  buildHumanReadSignalsTranscriptItems,
  emitHumanReadSignalsTextProjection,
} from "./read-signals-output";
import {
  buildActiveSpaceSessionContext,
  buildSpaceSessionProfileContext,
} from "./session-profile";
import { runReadonlyPiTuiSession } from "./shell/pi-tui/run-readonly-pi-tui-session";
import { parseSpaceMetaResponse } from "./space-meta-response";
import { createSpaceScreenStore } from "./state/space-screen-store";
import { buildHumanTranscriptProjection } from "./transcript/transcript-render";

export type SpaceHistorySignalKind = NonNullable<
  SpaceSignalsReadQuery["kinds"]
>[number];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Tail keeps protocol parsing and dual-view emission in one flow.
export async function runTail(input: {
  profile?: string;
  openMeldProfile?: OpenMeldProfile;
  baseUrl?: string;
  space: string;
  password?: string;
  limit: number;
  brief?: boolean;
  json: boolean;
  rawStream?: boolean;
  view?: string;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  kinds?: readonly SpaceHistorySignalKind[];
}) {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new Error("limit must be a non-negative integer");
  }

  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);

  assertFullSignalIdArgument({
    value: input.afterSignalId,
    flag: "--after-signal",
    resolvedView: runtime.resolvedView,
  });
  assertFullSignalIdArgument({
    value: input.aroundSignalId,
    flag: "--around-signal",
    resolvedView: runtime.resolvedView,
  });

  const openMeldProfile =
    input.openMeldProfile ??
    (await requireOpenMeldProfile({
      openMeldProfileId: input.profile,
      persistSelection: false,
      authAction: "viewing space history",
    }));
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const spaceApi = createCliSpaceApi(baseUrl);
  const space = input.space.trim();
  const historyQuery = buildHistoryReadQuery(input);
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const parsedResponse = await spaceApi.listSignals({
    spaceId: space,
    requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
    query: historyQuery,
  });
  const parsedEnvelopes = parsedResponse.signals.flatMap((item: unknown) => {
    const env = parseEnvelope(item);
    return env ? [env] : [];
  });
  let signalIndex = buildSignalIndex(parsedEnvelopes);
  const agentRawContract = runtime.resolvedView === "agent";
  const spaceMeta = await fetchHistorySpaceMeta({
    requestContext,
    baseUrl,
    password: input.password,
    space,
  }).catch(() => null);
  const identityDirectory = await loadSpaceIdentityDirectoryOrNull({
    spaceApi,
    spaceId: space,
    requestContext,
    resolvedPassword: input.password,
  });
  const identityOnlyMembersSnapshot =
    buildIdentityOnlyMembersSnapshotForReadProjection(identityDirectory);
  if (
    shouldPromoteHistorySignalIndex({
      identityDirectory,
      signals: parsedEnvelopes,
      signalIndex,
    })
  ) {
    signalIndex =
      (await loadSpaceSignalIndexOrNull({
        spaceApi,
        spaceId: space,
        requestContext,
        resolvedPassword: input.password,
        required: true,
      })) ?? signalIndex;
  }
  if (input.brief === true) {
    const threadByRootSignalId = await loadThreadSummaryByRootSignalId({
      spaceApi,
      spaceId: space,
      requestContext,
      password: input.password,
    });
    outJsonLine(
      buildSpaceHistoryBriefPayload({
        openMeldProfile,
        events: parsedEnvelopes,
        identityDirectory,
        signalIndex,
        spaceId: space,
        threadByRootSignalId,
      })
    );
    return;
  }
  const canUseHumanHistoryPiTui =
    runtime.resolvedView === "human" &&
    !input.json &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true;
  if (runtime.resolvedView === "human" && !input.json) {
    const threadByRootSignalId = await loadThreadSummaryByRootSignalId({
      spaceApi,
      spaceId: space,
      requestContext,
      password: input.password,
    });
    const transcriptItems = buildHumanReadSignalsTranscriptItems({
      openMeldProfile,
      events: parsedEnvelopes,
      membersSnapshot: identityOnlyMembersSnapshot,
      signalIndex,
      spaceId: space,
      threadByRootSignalId,
    });
    const transcriptProjection = buildHumanTranscriptProjection({
      items: transcriptItems,
      membersSnapshot: identityOnlyMembersSnapshot,
      sessionProfile: buildSpaceSessionProfileContext(openMeldProfile),
    });
    if (canUseHumanHistoryPiTui) {
      await runHumanHistoryPiTuiViewer({
        openMeldProfile,
        baseUrl,
        membersSnapshot: identityOnlyMembersSnapshot,
        password: input.password,
        space,
        spaceMeta,
        transcriptItems,
      });
      return;
    }
    emitHumanReadSignalsTextProjection({
      openMeldProfile,
      presenter,
      transcriptItems,
      membersSnapshot: identityOnlyMembersSnapshot,
      focusedSummary: buildFocusedHistorySummary({
        systemNoticeCount:
          transcriptProjection.hiddenSummary.hiddenSystemNoticeCount,
      }),
    });
    return;
  }
  const shouldEmitFullEnvelope = input.json || agentRawContract;
  const spaceMembersSnapshot = shouldEmitFullEnvelope
    ? null
    : identityOnlyMembersSnapshot;
  if (agentRawContract && spaceMeta) {
    outJsonLine(
      buildAgentSessionMetaPayload({
        accessMode: spaceMeta.accessMode,
        gatewayUrl: baseUrl,
        mode: "history viewer",
        passwordProtected: spaceMeta.passwordProtected,
        agentControllerConversationId: undefined,
        agentControllerRef: undefined,
        profileId: openMeldProfile.openMeldProfileId,
        profileKind: openMeldProfile.profileKind,
        profileName: openMeldProfile.profileName,
        ownerName: openMeldProfile.ownerName,
        ownerUserId: openMeldProfile.ownerUserId,
        spaceCreatedAt: spaceMeta.createdAt,
        spaceCreatorId: spaceMeta.creator?.profileId,
        spaceCreatorName: spaceMeta.creator?.profileName,
        spaceId: space,
        spaceName: spaceMeta.name,
        visibility: spaceMeta.visibility,
      })
    );
  }
  const threadByRootSignalId = await loadThreadSummaryByRootSignalId({
    spaceApi,
    spaceId: space,
    requestContext,
    password: input.password,
  });
  let emitted = 0;
  for (const env of parsedEnvelopes) {
    emitted += 1;

    if (agentRawContract) {
      outJsonLine(
        buildFormalSignalReadPayload({
          signal: normalizeAgentOutputEvent(env) as SignalEnvelope,
          identityDirectory,
          signalIndex,
          thread: threadByRootSignalId.get(env.id) ?? null,
        })
      );
      continue;
    }

    if (shouldEmitFullEnvelope) {
      presenter.data({
        code: "tail.signal",
        payload: buildFormalSignalReadPayload({
          signal: env,
          identityDirectory,
          signalIndex,
          thread: threadByRootSignalId.get(env.id) ?? null,
        }),
      });
      continue;
    }

    const textLine = formatTextEvent(env, {
      view: runtime.resolvedView,
      selfProfileId: openMeldProfile.openMeldProfileId,
      spaceMembersSnapshot,
    });
    if (textLine) {
      presenter.line({
        code:
          env.type === "signal.text" ? "tail.signal.text" : "tail.signal.other",
        text: textLine,
        data: env,
      });
      continue;
    }

    presenter.line({
      code: "tail.signal.other",
      text: `${env.type} (${env.profile?.profileId ?? "unknown"})`,
      data: env,
    });
  }

  if (emitted !== 0) {
    return;
  }

  if (agentRawContract) {
    return;
  }

  const emptyText = formatMessage(runtime.resolvedView, "tail.empty");
  if (shouldEmitFullEnvelope) {
    presenter.data({
      code: "tail.empty",
      payload: { text: emptyText },
    });
    return;
  }

  presenter.line({
    code: "tail.empty",
    text: emptyText,
  });
}

async function loadThreadSummaryByRootSignalId(input: {
  spaceApi: ReturnType<typeof createCliSpaceApi>;
  spaceId: string;
  requestContext: import("@openmeld/schemas/types").OpenMeldRequestContext;
  password?: string;
}): Promise<Map<string, SpaceSignalThreadSummary>> {
  const map = new Map<string, SpaceSignalThreadSummary>();
  try {
    const response = await input.spaceApi.listThreads({
      spaceId: input.spaceId,
      requestContext: input.requestContext,
      ...(input.password === undefined
        ? {}
        : { spacePassword: input.password }),
    });
    const previewByThreadId = new Map(
      response.previews.map((preview) => [preview.threadId, preview] as const)
    );
    for (const thread of response.threads) {
      const preview = previewByThreadId.get(thread.threadId);
      map.set(thread.rootSignalId, {
        threadId: thread.threadId,
        replyCount: preview?.replyCount ?? 0,
        replyPreviews: buildThreadReplyPreviews(preview?.signals ?? []),
      });
    }
  } catch {
    // fail-soft: thread metadata is decorative; history must still render
    // even when the thread listing call fails.
    return map;
  }
  return map;
}

// Backend thread previews return the earliest signals (ORDER BY created_at ASC,
// capped server-side). We surface the first N as a lightweight preview, so this
// is "earliest N", not "latest N" — slice direction and naming stay aligned with
// the server contract to avoid a hidden dependency on the server-side cap value.
const THREAD_REPLY_PREVIEW_LIMIT = 2;

function buildThreadReplyPreviews(
  rawSignals: readonly unknown[]
): SpaceSignalThreadReplyPreview[] {
  const parsed = rawSignals
    .slice(0, THREAD_REPLY_PREVIEW_LIMIT)
    .flatMap((item) => {
      const env = parseEnvelope(item);
      return env ? [env] : [];
    });
  const localIndex = buildSignalIndex(parsed);
  return parsed.map((signal) => {
    const projection = isMessageSemanticSignal(signal)
      ? buildSignalMessageReadProjection({
          signal,
          identityDirectory: null,
          signalIndex: localIndex,
        })
      : null;
    return {
      actorProfileId: signal.profile?.profileId ?? null,
      actorProfileName: signal.profile?.profileName ?? null,
      text: projection?.text ?? null,
    };
  });
}

function buildHistoryReadQuery(input: {
  limit: number;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  kinds?: readonly SpaceHistorySignalKind[];
}): {
  recent?: boolean;
  limit?: number;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  kinds?: readonly SpaceHistorySignalKind[];
} {
  const hasAfterSignal = Boolean(String(input.afterSignalId ?? "").trim());
  const hasAroundSignal = Boolean(String(input.aroundSignalId ?? "").trim());
  return {
    ...(hasAfterSignal
      ? {
          afterSignalId: input.afterSignalId,
          limit: input.limit,
        }
      : {}),
    ...(hasAroundSignal
      ? {
          aroundSignalId: input.aroundSignalId,
          beforeCount: input.beforeCount,
          afterCount: input.afterCount,
        }
      : {}),
    ...(hasAfterSignal || hasAroundSignal
      ? {}
      : {
          recent: true,
          limit: input.limit,
        }),
    fromProfileIds: input.fromProfileIds,
    kinds: input.kinds,
  };
}

function shouldPromoteHistorySignalIndex(input: {
  identityDirectory: SpaceIdentityDirectory | null;
  signals: readonly SignalEnvelope[];
  signalIndex: SpaceSignalIndex;
}): boolean {
  for (const signal of input.signals) {
    if (!isMessageSemanticSignal(signal)) {
      continue;
    }

    const projection = buildSignalMessageReadProjection({
      signal,
      identityDirectory: input.identityDirectory,
      signalIndex: input.signalIndex,
    });
    if (
      projection.replyToSignalId &&
      projection.replyToContext?.resolved !== true
    ) {
      return true;
    }
  }

  return false;
}

function buildSpaceHistoryBriefPayload(input: {
  openMeldProfile: OpenMeldProfile;
  events: readonly SignalEnvelope[];
  identityDirectory: SpaceIdentityDirectory | null;
  signalIndex: SpaceSignalIndex;
  spaceId: string;
  threadByRootSignalId: Map<string, SpaceSignalThreadSummary>;
}) {
  return {
    type: "space.history.brief",
    spaceId: input.spaceId,
    actingProfile: {
      profileId: input.openMeldProfile.openMeldProfileId,
      profileName: input.openMeldProfile.profileName,
      profileKind: input.openMeldProfile.profileKind,
      ownerUserId: input.openMeldProfile.ownerUserId,
      ownerName: input.openMeldProfile.ownerName ?? null,
    },
    proof: {
      conversationReadable: true,
      checkedBy: "space.history",
      note: "This command proves readable conversation access for the acting profile. It does not prove Wake execution success.",
    },
    messages: input.events.map((event) =>
      buildSpaceHistoryBriefMessage({
        event,
        identityDirectory: input.identityDirectory,
        signalIndex: input.signalIndex,
        thread: input.threadByRootSignalId.get(event.id) ?? null,
      })
    ),
    ...buildThreadNextCommandsField({
      spaceId: input.spaceId,
      profileId: input.openMeldProfile.openMeldProfileId,
      threadByRootSignalId: input.threadByRootSignalId,
    }),
  };
}

function buildThreadNextCommandsField(input: {
  spaceId: string;
  profileId: string;
  threadByRootSignalId: Map<string, SpaceSignalThreadSummary>;
}): { nextCommands?: string[] } {
  if (input.threadByRootSignalId.size === 0) {
    return {};
  }
  const threadIds = [
    ...new Set(
      [...input.threadByRootSignalId.values()].map(
        (summary) => summary.threadId
      )
    ),
  ];
  return {
    nextCommands: threadIds.map((threadId) =>
      formatOpenMeldCliCommand(
        `openmeld space thread ${input.spaceId} ${threadId} --profile ${input.profileId} --view agent`
      )
    ),
  };
}

function buildSpaceHistoryBriefMessage(input: {
  event: SignalEnvelope;
  identityDirectory: SpaceIdentityDirectory | null;
  signalIndex: SpaceSignalIndex;
  thread?: SpaceSignalThreadSummary | null;
}) {
  const messageReadProjection = isMessageSemanticSignal(input.event)
    ? buildSignalMessageReadProjection({
        signal: input.event,
        identityDirectory: input.identityDirectory,
        signalIndex: input.signalIndex,
      })
    : null;

  return {
    signalId: input.event.id,
    timestamp: input.event.ts,
    kind: input.event.type,
    actor: {
      profileId: input.event.profile?.profileId ?? null,
      profileName: input.event.profile?.profileName ?? null,
      profileKind: input.event.profile?.kind ?? null,
    },
    text: messageReadProjection?.text ?? null,
    replyTo: messageReadProjection?.replyToSignalId ?? null,
    wakeTargets: messageReadProjection?.wakeTargets ?? [],
    referenceTargets: messageReadProjection?.referenceTargets ?? [],
    mentionTargets: messageReadProjection?.mentionTargets ?? [],
    thread: input.thread ?? null,
  };
}

function isMessageSemanticSignal(
  signal: SignalEnvelope
): signal is
  | Extract<SignalEnvelope, { type: "signal.text" }>
  | Extract<SignalEnvelope, { type: "signal.status" }>
  | Extract<SignalEnvelope, { type: "signal.system_notice" }> {
  return (
    signal.type === "signal.text" ||
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  );
}

async function fetchHistorySpaceMeta(input: {
  requestContext: import("@openmeld/schemas/types").OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}) {
  const endpoint = toSpaceMetaUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  const res = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.history.meta",
    init: { headers },
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${raw}`);
  }
  return parseSpaceMetaResponse({
    raw,
    endpoint,
    operation: "fetchSpaceMeta",
  });
}

async function runHumanHistoryPiTuiViewer(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  membersSnapshot: SpaceMembersSnapshot | null;
  password?: string;
  space: string;
  spaceMeta: SpaceMeta | null;
  transcriptItems: ReturnType<typeof buildHumanReadSignalsTranscriptItems>;
}): Promise<void> {
  const store = createSpaceScreenStore();

  store.dispatch({
    type: "connection.connected",
  });
  store.dispatch({
    type: "members.updated",
    snapshot: input.membersSnapshot,
    updatedAtMs: Date.now(),
  });

  for (const transcriptItem of input.transcriptItems) {
    store.dispatch({
      type: "transcript.item.appended",
      item: transcriptItem,
    });
  }

  const context = buildHumanHistorySessionContext({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    space: input.space,
    spaceMeta: input.spaceMeta,
  });
  await runReadonlyPiTuiSession({
    context,
    getResources: () => ({
      sessionDiagnostics: {
        openMeldServiceLabel: "unknown",
        canWakeLocalAgentsLabel: "unknown",
      },
    }),
    store,
    syncOverlayInteraction: (kind) => {
      if (kind === "members") {
        syncMembersHistoryOverlayInteraction(store);
      }
    },
  });
}

function buildHumanHistorySessionContext(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  spaceMeta: SpaceMeta | null;
}) {
  return buildActiveSpaceSessionContext({
    profile: buildSpaceSessionProfileContext(input.openMeldProfile),
    baseUrl: input.baseUrl,
    connectionMode: "history",
    session: {
      accessMode: input.spaceMeta?.accessMode ?? null,
      passwordProtected: input.spaceMeta?.passwordProtected ?? null,
      spaceCreatedAt: input.spaceMeta?.createdAt ?? null,
      spaceCreatorId: input.spaceMeta?.creator?.profileId ?? null,
      spaceCreatorName: input.spaceMeta?.creator?.profileName ?? null,
      spaceId: input.space,
      spaceName: input.spaceMeta?.name ?? null,
      storageSoftLimitBytes:
        input.spaceMeta?.storageUsage?.softLimitBytes ?? null,
      storageUsagePercent: input.spaceMeta?.storageUsage?.usagePercent ?? null,
      storageUsedBytes: input.spaceMeta?.storageUsage?.usedBytes ?? null,
      visibility: input.spaceMeta?.visibility ?? null,
    },
  });
}

function syncMembersHistoryOverlayInteraction(
  store: ReturnType<typeof createSpaceScreenStore>
): void {
  const screenState = store.getState();
  if (screenState.overlay.kind !== "members") {
    return;
  }
  const activeItemId = resolveMembersSearchableActiveItemId({
    preferredActiveItemId: screenState.overlay.interaction.activeItemId,
    query: screenState.overlay.interaction.query,
    snapshot: screenState.members.snapshot,
  });
  store.dispatch({
    type: "overlay.active-item.updated",
    activeItemId,
  });
}

function buildFocusedHistorySummary(input: {
  systemNoticeCount: number;
}): string {
  const parts: string[] = [];
  if (input.systemNoticeCount > 0) {
    parts.push(
      `${String(input.systemNoticeCount)} ${input.systemNoticeCount === 1 ? "system notice" : "system notices"}`
    );
  }
  if (parts.length === 0) {
    return "";
  }
  return `History is showing chat first. Hidden ${parts.join(" and ")}.`;
}
