import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { buildSignalIndex, type SpaceSignalIndex } from "@openmeld/space";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { formatMessage, type MessageKey } from "../runtime/messages";
import type { Presenter } from "../runtime/presenter";
import type { SpaceSignalThreadSummary } from "./read-projection/formal-message-read-output";
import {
  buildSpaceSessionProfileContext,
  buildSpaceSessionProfileIdentity,
  rememberMembersSnapshotOwnerDisplayNames,
  rememberSessionOwnerDisplayName,
} from "./session-profile";
import { buildHumanTranscriptItemFromEvent } from "./transcript/transcript-item-builder";
import {
  buildHumanTranscriptProjection,
  renderTranscriptBlocks,
} from "./transcript/transcript-render";

export function buildHumanReadSignalsTranscriptItems(input: {
  openMeldProfile: OpenMeldProfile;
  events: readonly SignalEnvelope[];
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
  spaceId?: string;
  threadByRootSignalId?: ReadonlyMap<string, SpaceSignalThreadSummary> | null;
}) {
  const ownerDisplayNameByUserId = new Map<string, string>();
  rememberSessionOwnerDisplayName(
    ownerDisplayNameByUserId,
    input.openMeldProfile
  );
  rememberMembersSnapshotOwnerDisplayNames(
    ownerDisplayNameByUserId,
    input.membersSnapshot
  );
  const sessionProfileIdentity = buildSpaceSessionProfileIdentity({
    openMeldProfile: input.openMeldProfile,
  });
  const signalIndex = input.signalIndex ?? buildSignalIndex(input.events);

  return input.events.flatMap((event) => {
    const transcriptItem = buildHumanTranscriptItemFromEvent({
      event,
      selfProfileId: input.openMeldProfile.openMeldProfileId,
      sessionProfileIdentity,
      signalIndex,
      ownerDisplayNameByUserId,
      spaceId: input.spaceId,
      spaceMembersSnapshot: input.membersSnapshot,
      threadSummary: input.threadByRootSignalId?.get(event.id) ?? null,
    });
    return transcriptItem ? [transcriptItem] : [];
  });
}

export function emitHumanReadSignalsTextProjection(input: {
  openMeldProfile: OpenMeldProfile;
  presenter: Presenter;
  transcriptItems: ReturnType<typeof buildHumanReadSignalsTranscriptItems>;
  membersSnapshot: SpaceMembersSnapshot | null;
  emptyCode?: MessageKey;
  focusedSummary?: string | null;
}): void {
  const projection = buildHumanTranscriptProjection({
    items: input.transcriptItems,
    membersSnapshot: input.membersSnapshot,
    sessionProfile: buildSpaceSessionProfileContext(input.openMeldProfile),
  });
  const renderWidth = Math.max(process.stdout.columns ?? 100, 40);
  const transcriptLines = renderTranscriptBlocks(
    projection.transcriptBlocks,
    renderWidth
  );

  for (const line of transcriptLines) {
    input.presenter.line({
      code: "tail.signal.text",
      text: line,
    });
  }

  const focusedSummary = String(input.focusedSummary ?? "").trim();
  if (focusedSummary) {
    input.presenter.line({
      code: "tail.history.focused_summary",
      text: focusedSummary,
    });
  }

  if (transcriptLines.length > 0 || focusedSummary) {
    return;
  }

  const emptyCode = input.emptyCode ?? "tail.empty";
  input.presenter.line({
    code: emptyCode,
    text: formatMessage("human", emptyCode),
  });
}
