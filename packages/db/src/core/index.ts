// biome-ignore-all lint/performance/noBarrelFile: This subpath entrypoint intentionally re-exports the canonical core db surface.

export {
  agentActivityDailyAggregates,
  agentActivityDailySessionKeys,
  agentActivityDigests,
  agentActivityEvents,
  agentActivitySessions,
} from "./agent-activity.schema.ts";
export { openMeldDaemonAgentExecutionReadinessImpacts } from "./agent-execution-readiness-impact.schema.ts";
export { openMeldDaemonAgentProfileBindings } from "./agent-profile-binding.schema.ts";
export { agentProfileCreationDefaults } from "./agent-profile-creation-defaults.schema.ts";
export {
  centerAgentAttentionRequests,
  centerAgentAuditJournal,
  centerAgentConnectorActionOperations,
  centerAgentContextLoadReceipts,
  centerAgentContextManifestMaterializations,
  centerAgentContextManifests,
  centerAgentDesignations,
} from "./center-agent.schema.ts";
export {
  centerAgentMemberResearchBatches,
  centerAgentMemberResearchComputerFiles,
  centerAgentMemberResearchTasks,
} from "./center-agent-member-research.schema.ts";
export {
  centerAgentMemoryPolicies,
  centerAgentMemorySubjects,
} from "./center-agent-memory.schema.ts";
export { centerAgentPublicationOperations } from "./center-agent-publication.schema.ts";
export {
  centerAgentTaskAdmissionOutbox,
  centerAgentTaskAttempts,
  centerAgentTaskAuthorizedReaders,
  centerAgentTaskEvents,
  centerAgentTasks,
} from "./center-agent-tasks.schema.ts";
export { openMeldDaemonConnectedComputers } from "./connected-computer.schema.ts";
export {
  connectorAppRequests,
  connectorConnections,
  githubAppInstallationStates,
} from "./connector-connection.schema.ts";
export { openMeldDaemonCurrentDeviceTargets } from "./current-device-target.schema.ts";
export {
  agentActivityExecutionLinks,
  coreSchema,
  openMeldDaemonDispatchAttempts,
  openMeldDaemonDispatchLedger,
  openMeldDaemonDispatchResultInbox,
  openMeldDaemonDispatchResults,
  openMeldDaemonDlq,
  openMeldDaemonOpsDecisions,
  openMeldDaemonRuntimeCoordinatorCreationDiagnostics,
  openMeldDaemonRuntimeCoordinatorExecutionEvents,
  openMeldDaemonRuntimeCoordinatorExecutions,
  openMeldRemoteAgentConversationGenerations,
  openMeldRemoteAgentDailyAdmissions,
  openMeldRemoteAgentNativeDeliveryLedger,
  openMeldRemoteAgentOrgGuardrails,
  openMeldRemoteAgentSlackEventIngress,
  openMeldRemoteAgentSlackThreadContextCursors,
  openMeldRemoteAgentSlackWorkspaceBindings,
  slackChannelIntroductionItems,
  slackChannelIntroductionRuns,
  slackInstallationWelcomeDeliveries,
  slackInstallationWelcomePreparations,
  slackTeammateInvitationDeliveries,
  slackUserIdentityLinks,
  slackUserIdentityLinkTokens,
} from "./dispatch.schema.ts";
export type {
  CoreRequiredNamedIndex,
  CoreRequiredNamedIndexColumn,
  CoreRequiredSchemaObject,
  CoreRequiredTableColumn,
  CoreRequiredUniqueConstraint,
} from "./dispatch-schema-requirements.ts";
export {
  CORE_DISPATCH_REQUIRED_NAMED_INDEXES,
  CORE_DISPATCH_REQUIRED_SCHEMA_OBJECTS,
  CORE_DISPATCH_REQUIRED_TABLE_COLUMNS,
  CORE_DISPATCH_REQUIRED_UNIQUE_CONSTRAINTS,
} from "./dispatch-schema-requirements.ts";
export { evalReports } from "./eval-report.schema.ts";
export {
  CORE_AGENT_ACTIVITY_SCHEMA_DEFINITION_PATH,
  CORE_CENTER_AGENT_MEMBER_RESEARCH_SCHEMA_DEFINITION_PATH,
  CORE_CENTER_AGENT_TASKS_SCHEMA_DEFINITION_PATH,
  CORE_CONNECTOR_CONNECTION_SCHEMA_DEFINITION_PATH,
  CORE_DB_BINDING_NAME,
  CORE_DB_RELEASE_NOTES,
  CORE_EVAL_REPORT_SCHEMA_DEFINITION_PATH,
  CORE_FEEDBACK_SCHEMA_DEFINITION_PATH,
  CORE_INBOX_SCHEMA_DEFINITION_PATH,
  CORE_OPPORTUNITY_SCHEMA_DEFINITION_PATH,
  CORE_ORGANIZATION_DOCUMENT_SCHEMA_DEFINITION_PATH,
  CORE_ORGANIZATION_INFORMATION_PROTECTION_SCHEMA_DEFINITION_PATH,
  CORE_PROJECT_SCHEMA_DEFINITION_PATH,
  CORE_ROUTINE_SCHEMA_DEFINITION_PATH,
  CORE_SPACE_ATTACHMENT_SCHEMA_DEFINITION_PATH,
  getCoreDbMigrationSources,
  getCoreDbSchemaSources,
} from "./fact-metadata.ts";
export {
  openMeldFeedbackInboxes,
  openMeldFeedbackIssues,
  openMeldFeedbackReportingPolicies,
} from "./feedback.schema.ts";
export { openMeldDaemonForgottenDevices } from "./forgotten-device.schema.ts";
export {
  inboxCenterAgentReadWatermarks,
  inboxEmailDeliveries,
  inboxItems,
  inboxNotificationPreferences,
} from "./inbox.schema.ts";
export {
  openMeldRemoteAgentLarkPlatformChannelConnections,
  openMeldRemoteAgentLarkPlatformChannelCredentials,
  openMeldRemoteAgentLarkPlatformContextCursors,
  openMeldRemoteAgentLarkPlatformIdentityLinks,
  openMeldRemoteAgentLarkPlatformRegistrationAttempts,
  openMeldRemoteAgentMessageChannelEventIngress,
  openMeldRemoteAgentMessageChannelIdentityLinkTokens,
} from "./message-channel.schema.ts";
export { organizationOpportunities } from "./opportunity.schema.ts";
export { organizationBindingAuthorizations } from "./organization-binding-authorization.schema.ts";
export { organizationBindingAuthorizationPreferences } from "./organization-binding-authorization-preference.schema.ts";
export { organizationDocuments } from "./organization-document.schema.ts";
export { organizationDocumentFolders } from "./organization-document-folder.schema.ts";
export { centerAgentOrganizationDocumentOperations } from "./organization-document-operation.schema.ts";
export { organizationInformationProtectionPolicies } from "./organization-information-protection.schema.ts";
export {
  centerAgentOrganizationSkillOperations,
  organizationSkillActivations,
  organizationSkillMaintainers,
  organizationSkillReleases,
  organizationSkills,
} from "./organization-skill.schema.ts";
export { openMeldDaemonOwnedDevices } from "./owned-device.schema.ts";
export { openMeldDaemonPreHeadFailurePublicationOutbox } from "./pre-head-failure-publication-outbox.schema.ts";
export {
  openMeldDaemonPrepareSessionEvents,
  openMeldDaemonPrepareSessions,
  openMeldDaemonPrepareSessionTokens,
} from "./prepare-session.schema.ts";
export {
  centerAgentProjectOperations,
  centerAgentProjectRemoveConfirmations,
  projects,
} from "./project.schema.ts";
export { openMeldDaemonProviderAccessEvidence } from "./provider-access-evidence.schema.ts";
export { openMeldDaemonProviderConversationProofs } from "./provider-conversation-proof.schema.ts";
export { routineRuns, routines } from "./routine.schema.ts";
export { openMeldDaemonRuntimeAgentControllerReports } from "./runtime-agent-controller-report.schema.ts";
export { openMeldDaemonRuntimeRegistryRecords } from "./runtime-registry.schema.ts";
export { spaceAttachments } from "./space-attachment.schema.ts";
export {
  spaceIndexMemberships,
  spaceIndexProjectionEvents,
  spaceIndexSpaces,
} from "./space-index.schema.ts";
