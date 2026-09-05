// biome-ignore-all lint/performance/noBarrelFile: Shared space package intentionally exposes a stable root entrypoint.

export {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  getSpaceAccessRequestId,
  type SpaceAccessActor,
  type SpaceAccessAuditFields,
  type SpaceAccessContext,
  type SpaceAccessProof,
  toSpaceAccessAuditFields,
} from "./access/space-access-context";
export {
  buildPublicSpaceEntryPath,
  buildPublicSpaceEntryUrl,
} from "./access/space-entry-link";
export {
  listSpaceBareMentionDiagnostics,
  type SpaceBareMentionDiagnostic,
} from "./authoring/bare-mention-diagnostics";
export {
  assertNoRemovedCcSpaceAddressingSyntax,
  formatRemovedCcRelationMessage,
  isSpaceComposerSubmissionError,
  type PreparedSpaceComposerSubmission,
  prepareSpaceComposerSubmission,
  prepareSpaceFileOnlySubmission,
  type SpaceComposerAuthoredMentionInTextOrder,
  type SpaceComposerReplyTarget,
  SpaceComposerSubmissionError,
  type SpaceComposerSubmissionErrorCode,
} from "./authoring/composer-submission";
export {
  listSpaceMemberDirectorySendTargets,
  type SpaceMemberDirectorySendTargetEntry,
} from "./authoring/member-directory-send-targets";
export { extractMentionAuthoringPrefix } from "./authoring/mention-authoring-prefix";
export {
  closeMentionPickerState,
  enterRelationPickerState,
  isRelationPickerState,
  isTargetPickerState,
  type MentionPickerState,
  type MentionPickerTarget,
  openTargetPickerState,
  returnToTargetPickerState,
} from "./authoring/mention-picker-state";
export {
  buildRecentMentionRankByProfileId,
  listSpaceMentionRelationChoices,
  listSpaceMentionSuggestions,
  mergeRecentMentionProfileIds,
  normalizeRecentMentionProfileIds,
  resolveNextRecentMentionProfileIdsForQueuedText,
  type SpaceMentionRelationChoice,
  type SpaceMentionSuggestion,
} from "./authoring/mention-suggestions";
export {
  listSpaceSendTargets,
  type SpaceSendTargetAllowedRelations,
  type SpaceSendTargetProjectionEntry,
  type SpaceSendTargetWakeAvailability,
} from "./authoring/send-target-projection";
export {
  assertValidSpaceCanonicalMentionSyntax,
  type PreparedHumanSpaceTypedSubmission,
  type PreparedOneShotSpaceTypedSubmission,
  prepareHumanSpaceTypedSubmission,
  prepareOneShotSpaceTypedSubmission,
  type SpaceCanonicalMentionInTextOrder,
  type SpaceResolvedStructuredTargetSet,
  spaceTextHasCanonicalMentionAttempts,
  spaceTextHasOneShotMentionAttempts,
} from "./authoring/typed-submission";
export {
  buildSpaceProfileAddPlan,
  getSpaceProfileAddModeProfileKinds,
  type SpaceProfileAddCandidate,
  type SpaceProfileAddExcludedReason,
  type SpaceProfileAddInvalidSelection,
  type SpaceProfileAddMember,
  type SpaceProfileAddMode,
  type SpaceProfileAddPlan,
  type SpaceProfileAddProfile,
  type SpaceProfileAddProfileKind,
  type SpaceProfileAddSelector,
} from "./membership/profile-add-plan";
export {
  type AgentDirectConversationSpaceStateInput,
  isAgentDirectConversationSpace,
} from "./presentation/agent-direct-conversation-space";
export {
  buildDirectMessagePairKey,
  type DirectMessageSpaceStateInput,
  isDirectMessageSpace,
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "./presentation/direct-message-space";
export {
  type RgbColor,
  resolveSpaceProfileAccent,
  type SpaceProfileAccent,
  type SpaceProfileAccentIdentity,
} from "./presentation/profile-accent";
export {
  resolveSpaceDeleteActionVisibility,
  type SpaceDeleteActionVisibility,
  type SpaceDeleteActionVisibilityReason,
} from "./presentation/space-delete-action";
export {
  buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation,
  buildSpaceMemberAgentPresencePresentation,
  buildSpaceMemberAgentPublicCollaborationPresencePresentation,
  type SpaceMemberAgentPresencePresentation,
} from "./presentation/space-member-agent-presence";
export {
  resolveSpaceMemberAgentOwnerWakeDiagnosticsView,
  resolveSpaceMemberAgentPublicCollaborationView,
  type SpaceMemberAgentOwnerWakeDiagnosticsView,
  type SpaceMemberAgentPublicCollaborationView,
} from "./presentation/space-member-agent-views";
export {
  buildSpaceMemberDirectory,
  type SpaceMemberDirectory,
  type SpaceMemberDirectoryEntry,
  type SpaceMemberDirectorySection,
  type SpaceMemberDirectorySectionId,
} from "./presentation/space-member-directory";
export { OPENMELD_WELCOMING_SPACE_PURPOSE } from "./presentation/welcoming-space";
export {
  SPACE_DISPATCH_HISTORY_STATES,
  type SpaceDispatchHistoryState,
} from "./read-projection/dispatch-history";
export { buildSpaceMemberDirectoryFromIdentityDirectory } from "./read-projection/member-directory";
export {
  createSpaceMemberIdentityIndex,
  type SpaceMemberIdentityEntry,
  type SpaceMemberIdentityIndex,
} from "./read-projection/member-identity-index";
export {
  buildDispatchResultMessageReadProjection,
  buildSignalIndex,
  buildSignalMessageReadProjection,
  buildSpaceMessageReadRelationSummary,
  resolveReplyToContext,
  type SpaceMessageReadProjection,
  type SpaceMessageReadRelationSummary,
  type SpaceMessageReadTargetRef,
  type SpaceMessageReadTargetResolutionReasonCode,
  type SpaceMessageReadTargetResolutionStatus,
  type SpaceMessageReplyContext,
  type SpaceMessageThreadRef,
  type SpaceSignalIndex,
} from "./read-projection/message-read-projection";
export {
  buildSpaceRoundReadProjection,
  buildSpaceRoundSignalPublication,
  type SpaceRoundReadDispatchExecutionEvidence,
  type SpaceRoundReadDispatchState,
  type SpaceRoundReadProjection,
  type SpaceRoundReadPublicOutcome,
  type SpaceRoundReadPublishedSignalType,
  type SpaceRoundReadTargetDispatchEvidence,
  type SpaceRoundReadTargetProjection,
  type SpaceRoundReadTargetRelation,
  type SpaceRoundSignalPublication,
} from "./read-projection/round-read-projection";
export {
  buildDispatchResultReplyWorkflowProjection,
  buildSignalReplyWorkflowProjection,
  buildUpdatesReplyWorkflowProjection,
  type SpaceReplyWorkflowProjection,
} from "./reply-workflow/reply-workflow-projection";
export {
  buildSpaceMentionProfileIndex,
  collectResolvedSpaceMentions,
  listRecentMentionProfileIdsFromText,
  type ResolvedSpaceMention,
  type SpaceMentionProfileIdentity,
  type SpaceMentionProfileIndex,
} from "./target-identity/mention-resolution";
export {
  collectCanonicalMentionLabelMatches,
  type MentionTextLabelMatch,
} from "./target-identity/mention-text";
export {
  createSpaceTargetCatalog,
  listSpaceTargetCatalog,
  normalizeReadableMentionLookupToken,
  type SpaceTargetCatalog,
  type SpaceTargetCatalogEntry,
  type SpaceTargetRelationSupport,
  type SpaceTargetWakeAvailability,
} from "./target-identity/target-catalog";
export {
  applyWakeProgressSignals,
  buildWakeProgressItemFromTransientSignal,
  buildWakeProgressMessage,
  clearWakeProgressItemsForSignal,
  createWakeProgressItem,
  filterVisibleWakeProgressItems,
  hasVisibleActiveWakeProgress,
  isActiveWakeProgressItem,
  isWakeClosingSystemNoticeType,
  isWakeProgressSourceSignalRecoverable,
  mergeWakeProgressItems,
  type WakeProgressDraft,
} from "./wake-progress/wake-progress-projection";
