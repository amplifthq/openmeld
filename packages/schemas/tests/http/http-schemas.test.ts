import { describe, expect, it } from "vitest";
import {
  accountSpaceIndexItemSchema,
  accountSpaceIndexResponseSchema,
  addCenterAgentToSpaceBodySchema,
  addOrganizationDirectoryProfilesToSpaceBodySchema,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  catchupResponseSchema,
  convertDirectMessageToSpaceBodySchema,
  createAgentProfileBodySchema,
  createAgentProfileResponseSchema,
  createHumanProfileBodySchema,
  createHumanProfileResponseSchema,
  createSpaceBodySchema,
  createSpaceDiagnosticReportBodySchema,
  createSpaceDiagnosticReportResponseSchema,
  createSpacePasswordBodySchema,
  daemonRouteObservationResponseSchema,
  deleteSpaceResponseSchema,
  ensureManagedAgentProfileBodySchema,
  ensureManagedAgentProfileResponseSchema,
  forgetComputerResponseSchema,
  forgetCurrentComputerResponseSchema,
  gatewayErrorCodeSchema,
  getSpaceContractResponseSchema,
  getSpaceDispatchLookupInputSchema,
  getSpaceDispatchLookupResponseSchema,
  getSpaceDispatchResultInputSchema,
  getSpaceDispatchResultResponseSchema,
  getSpaceStatusInputSchema,
  getSpaceStatusResponseSchema,
  getSpaceUpdatesInputSchema,
  getSpaceUpdatesResponseSchema,
  joinWaitlistBodySchema,
  joinWaitlistResponseSchema,
  leaveSpaceResponseSchema,
  listProfileSpaceHistoryQuerySchema,
  listProfileSpaceHistoryResponseSchema,
  listProfilesResponseSchema,
  listSignalsQuerySchema,
  listSpaceDispatchTraceFinalVisibleSignalCandidates,
  MAX_SPACE_GUIDE_LENGTH,
  MAX_SPACE_NAME_LENGTH,
  messageSearchQuerySchema,
  mutateSpaceTaskBodySchema,
  normalizeListSignalsReadQuerySemantics,
  normalizeSpaceCursorPatch,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
  OBSERVABILITY_CLOUDFLARE_RUNTIME_EVENT_MODEL_VERSION,
  OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
  observabilityCloudflareAnalyticsDataPointSchema,
  observabilityCloudflareRuntimeEventSchema,
  observabilityWakeCorrelationSchema,
  observabilityWakeTraceSelectorSchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  patchProfileSpaceHistoryStatusBodySchema,
  patchSpaceContractBodySchema,
  patchSpaceContractResponseSchema,
  patchSpaceMetaBodySchema,
  postNormalMessageBodySchema,
  postResolvedSpaceMembersBodySchema,
  postSpaceDispatchOutboxRedriveBodySchema,
  postSpaceDispatchOutboxRedriveResponseSchema,
  postSpaceMembersBodySchema,
  postSpaceMembersResponseSchema,
  postSpaceThreadSignalBodySchema,
  profileSpaceHistoryRecordSchema,
  projectObservabilityCloudflareAnalyticsDataPoint,
  projectObservabilityCloudflareRuntimeConsoleEvent,
  projectObservabilityCloudflareRuntimeEvent,
  projectObservabilityWakeCorrelation,
  projectSpaceDispatchTraceFinalVisibleOutcome,
  projectSpaceDispatchTraceRootCause,
  putSpaceContractBodySchema,
  putSpaceContractResponseSchema,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  readListSignalsQueryRawValues,
  removeSpaceMembersBodySchema,
  removeSpaceMembersResponseSchema,
  resolveInitialSpaceAccessMode,
  resolveProfileResponseSchema,
  SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS,
  SPACE_PASSWORD_MIN_LENGTH,
  SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_ERROR_CODE,
  SPACE_TASK_OPERATION_ID_MAX_CHARS,
  SPACE_UPDATES_DEFAULT_LIMIT,
  SPACE_UPDATES_MAX_LIMIT,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
  setAuthPasswordBodySchema,
  setAuthPasswordResponseSchema,
  setSpaceAccessModeBodySchema,
  shouldLogObservabilityCloudflareRuntimeEvent,
  spaceAccessModeSchema,
  spaceAccessModeStateSchema,
  spaceDispatchTraceResponseSchema,
  spaceMemberDirectorySchema,
  spaceMembersSnapshotSchema,
  spaceMetaSchema,
  spacePasswordSchema,
  spacePasswordStateSchema,
  spaceRouteParamsSchema,
  spaceSignalAuthoringPolicySchema,
  spaceStorageUsageSchema,
  spaceTaskDetailOptionsSchema,
  spaceTaskGitHubIssueOperationId,
  spaceTaskSchema,
  updateProfileResponseSchema,
  upsertProfileSpaceHistoryBodySchema,
  upsertProfileSpaceHistoryResponseSchema,
  upsertSpacePasswordBodySchema,
  validateSpaceSignalClientMessageIdPolicy,
  waitlistErrorResponseSchema,
} from "../../src/index";
import { createSpaceMemberAgentExecutionReadiness } from "../../src/testing/space-members";

const CLOUDFLARE_ANALYTICS_LONG_SPACE_INDEX_PATTERN = /^space-x+:[a-z0-9]+$/;

describe("http schemas", () => {
  const SPACE_ID = "space-1";
  const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
  const SECOND_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
  const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

  describe("setAuthPassword schemas", () => {
    it("accepts the canonical request shape", () => {
      const parsed = setAuthPasswordBodySchema.safeParse({
        newPassword: "Password123!",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects invalid request payloads", () => {
      const missingPassword = setAuthPasswordBodySchema.safeParse({});
      expect(missingPassword.success).toBe(false);

      const nonStringPassword = setAuthPasswordBodySchema.safeParse({
        newPassword: 12_345_678,
      });
      expect(nonStringPassword.success).toBe(false);
    });

    it("rejects unknown request keys and accepts the response shape", () => {
      const requestWithExtraKey = setAuthPasswordBodySchema.safeParse({
        newPassword: "Password123!",
        extra: true,
      });
      expect(requestWithExtraKey.success).toBe(false);

      const response = setAuthPasswordResponseSchema.safeParse({
        status: true,
      });
      expect(response.success).toBe(true);
    });
  });

  describe("space dispatch outbox redrive schemas", () => {
    it("accepts the internal RuntimeCoordinator recovery redrive contract", () => {
      expect(
        postSpaceDispatchOutboxRedriveBodySchema.safeParse({
          reason: "runtime_coordinator_head_waiting_recovery",
          targetProfileId: "agt-1",
          targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|5:agt-1",
        }).success
      ).toBe(true);

      expect(
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse({
          dispatchId: "dispatch-1",
          ok: true,
          status: "enqueued",
          targetProfileId: "agt-1",
        }).success
      ).toBe(true);

      expect(
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse({
          dispatchId: "dispatch-1",
          ok: true,
          status: "submitted",
          targetProfileId: "agt-1",
        }).success
      ).toBe(true);

      expect(
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse({
          dispatchId: "dispatch-1",
          ok: true,
          status: "retry_scheduled",
          targetProfileId: "agt-1",
        }).success
      ).toBe(true);
    });

    it("accepts lifecycle mismatch as an explicit fail-closed redrive response", () => {
      expect(
        postSpaceDispatchOutboxRedriveResponseSchema.safeParse({
          dispatchId: "dispatch-1",
          ok: false,
          reasonCode: "space.dispatch_outbox_redrive_lifecycle_mismatch",
          status: "lifecycle_mismatch",
          targetProfileId: "agt-1",
        }).success
      ).toBe(true);
    });

    it("rejects unknown redrive reasons", () => {
      expect(
        postSpaceDispatchOutboxRedriveBodySchema.safeParse({
          reason: "queue_retry",
          targetProfileId: "agt-1",
          targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|5:agt-1",
        }).success
      ).toBe(false);
    });
  });

  describe("waitlist schemas", () => {
    it("normalizes a valid waitlist request email", () => {
      const result = joinWaitlistBodySchema.safeParse({
        email: "  Test@Example.com ",
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        email: "test@example.com",
      });
    });

    it("rejects empty or invalid waitlist emails", () => {
      expect(
        joinWaitlistBodySchema.safeParse({
          email: "",
        }).success
      ).toBe(false);

      expect(
        joinWaitlistBodySchema.safeParse({
          email: "not-an-email",
        }).success
      ).toBe(false);
    });

    it("accepts waitlist success and invalid input error payloads", () => {
      expect(
        joinWaitlistResponseSchema.safeParse({
          ok: true,
          status: "created",
        }).success
      ).toBe(true);

      expect(
        joinWaitlistResponseSchema.safeParse({
          ok: true,
          status: "already_exists",
        }).success
      ).toBe(true);

      expect(
        waitlistErrorResponseSchema.safeParse({
          ok: false,
          code: "waitlist.invalid_input",
          message: "invalid request body",
        }).success
      ).toBe(true);
    });
  });

  describe("daemon route observation schema", () => {
    it("accepts online and offline daemon route observations", () => {
      expect(
        daemonRouteObservationResponseSchema.safeParse({
          observedAt: "2026-03-26T00:00:00.000Z",
          profileId: AGENT_PROFILE_ID,
          route: {
            online: true,
            daemonSessionId: "daemon-session-1",
            deviceId: "device-1",
            lane: "dev-local",
            connectionGeneration: 2,
            leaseEpoch: 4,
            lastHeartbeatMs: 1234,
            capabilities: {},
            executionCompatibility: {
              expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              reasonCode: "daemon.runtime_contract.compatible",
              status: "compatible",
            },
          },
        }).success
      ).toBe(true);

      expect(
        daemonRouteObservationResponseSchema.safeParse({
          observedAt: "2026-03-26T00:00:00.000Z",
          profileId: AGENT_PROFILE_ID,
          route: {
            online: false,
            reasonCode: "daemon.profile.offline",
          },
        }).success
      ).toBe(true);
    });

    it("rejects malformed daemon route observations", () => {
      expect(
        daemonRouteObservationResponseSchema.safeParse({
          observedAt: "",
          profileId: AGENT_PROFILE_ID,
          route: {
            online: false,
            reasonCode: "daemon.profile.offline",
          },
        }).success
      ).toBe(false);
    });

    it("rejects internal delivery reconnect state on public route observations", () => {
      const internalDeliveryState = ["re", "connecting"].join("");
      expect(
        daemonRouteObservationResponseSchema.safeParse({
          observedAt: "2026-03-26T00:00:00.000Z",
          profileId: AGENT_PROFILE_ID,
          route: {
            online: false,
            reasonCode: "daemon.profile.offline",
            lastHeartbeatMs: 1234,
            deliveryState: internalDeliveryState,
          },
        }).success
      ).toBe(false);
    });
  });

  describe("current device schemas", () => {
    it("accepts forgotten-computer responses", () => {
      expect(
        forgetCurrentComputerResponseSchema.safeParse({
          status: "forgotten",
          forgottenDeviceId: "device-1",
          currentDeviceTarget: {
            availability: "missing",
          },
        }).success
      ).toBe(true);
      expect(
        forgetComputerResponseSchema.safeParse({
          status: "forgotten",
          forgottenDeviceId: "device-2",
          currentDeviceTarget: {
            availability: "resolved",
            deviceId: "device-1",
            runtimeLane: "dev-local",
          },
        }).success
      ).toBe(true);
      expect(gatewayErrorCodeSchema.safeParse("device.forgotten").success).toBe(
        true
      );
    });
  });

  describe("profiles schemas", () => {
    it("accepts canonical profile list and resolve payloads", () => {
      const baseProfile = {
        openMeldProfileId: HUMAN_PROFILE_ID,
        profileName: "Felix Human",
        profileHandle: "felix-human",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "user_1",
        ownerName: "Felix",
        source: "cli_create",
        managedRole: null,
        createdByUserId: "user_1",
        creatorProfileId: null,
        lastUsedAt: "2026-04-14T08:00:00.000Z",
        createdAt: "2026-04-14T07:00:00.000Z",
        updatedAt: "2026-04-14T08:00:00.000Z",
      };

      expect(
        listProfilesResponseSchema.safeParse({
          ok: true,
          profiles: [
            baseProfile,
            {
              ...baseProfile,
              openMeldProfileId: AGENT_PROFILE_ID,
              profileName: "Design Agent",
              profileHandle: "design-agent",
              profileKind: "agent",
              isDefault: false,
            },
          ],
        }).success
      ).toBe(true);

      const profileWithoutManagedRole = Object.fromEntries(
        Object.entries(baseProfile).filter(([key]) => key !== "managedRole")
      );
      const profileWithoutManagedRoleResult =
        listProfilesResponseSchema.safeParse({
          ok: true,
          profiles: [profileWithoutManagedRole],
        });
      expect(profileWithoutManagedRoleResult.success).toBe(true);
      if (profileWithoutManagedRoleResult.success) {
        expect(
          profileWithoutManagedRoleResult.data.profiles[0]?.managedRole
        ).toBeNull();
      }

      expect(
        resolveProfileResponseSchema.safeParse({
          ok: true,
          profile: baseProfile,
        }).success
      ).toBe(true);

      expect(
        createHumanProfileResponseSchema.safeParse({
          ok: true,
          profile: baseProfile,
        }).success
      ).toBe(true);

      expect(
        createAgentProfileResponseSchema.safeParse({
          ok: true,
          profile: {
            ...baseProfile,
            openMeldProfileId: AGENT_PROFILE_ID,
            profileName: "Research Agent",
            profileHandle: "research-agent",
            profileKind: "agent",
            isDefault: false,
          },
        }).success
      ).toBe(true);

      expect(
        ensureManagedAgentProfileResponseSchema.safeParse({
          ok: true,
          profile: {
            ...baseProfile,
            openMeldProfileId: AGENT_PROFILE_ID,
            profileName: "Felix's Welcoming Assistant",
            profileHandle: "felix-s-openmeld-assistant",
            profileKind: "agent",
            isDefault: false,
            managedRole: "openmeld_assistant",
          },
        }).success
      ).toBe(true);

      expect(
        updateProfileResponseSchema.safeParse({
          ok: true,
          profile: {
            ...baseProfile,
            openMeldProfileId: AGENT_PROFILE_ID,
            profileName: "Research Agent",
            profileHandle: "research-agent",
            profileKind: "agent",
            isDefault: false,
          },
        }).success
      ).toBe(true);
    });

    it("accepts the canonical create human profile request body", () => {
      expect(
        createHumanProfileBodySchema.safeParse({
          profileName: "New Human Profile",
          creatorProfileId: SECOND_HUMAN_PROFILE_ID,
        }).success
      ).toBe(true);

      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
          creatorProfileId: SECOND_HUMAN_PROFILE_ID,
          idempotencyKey: "agent-profile-create:request-123",
        }).success
      ).toBe(true);

      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
          idempotencyKey: " ",
        }).success
      ).toBe(false);

      expect(
        ensureManagedAgentProfileBodySchema.safeParse({
          profileName: "Felix's Welcoming Assistant",
          managedRole: "openmeld_assistant",
          creatorProfileId: SECOND_HUMAN_PROFILE_ID,
        }).success
      ).toBe(true);
    });

    it("rejects Agent Controller Binding fields in create agent profile auth input", () => {
      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
        }).success
      ).toBe(true);

      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
          agentControllerRef: "builtin:codex",
        }).success
      ).toBe(false);

      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
          agentControllerConversationId: "019e86cb-dbdc-7ba0-96a6-9fa8ca21d25c",
        }).success
      ).toBe(false);

      expect(
        createAgentProfileBodySchema.safeParse({
          profileName: "Research Agent",
          agentControllerRef: "builtin:codex",
          controllerEnabled: true,
        }).success
      ).toBe(false);

      expect(
        ensureManagedAgentProfileBodySchema.safeParse({
          profileName: "Felix's Welcoming Assistant",
          managedRole: "profile_name",
        }).success
      ).toBe(false);

      expect(
        ensureManagedAgentProfileBodySchema.safeParse({
          profileName: "Felix's Welcoming Assistant",
          managedRole: "openmeld_assistant",
          agentControllerRef: "builtin:codex",
        }).success
      ).toBe(false);
    });

    it("rejects malformed profile payloads", () => {
      expect(
        listProfilesResponseSchema.safeParse({
          ok: true,
          profiles: [
            {
              openMeldProfileId: HUMAN_PROFILE_ID,
              profileName: "Felix Human",
              profileHandle: "felix-human",
              profileKind: "human",
              isDefault: true,
              status: "active",
              ownerUserId: "user_1",
              source: "manual",
              bindingState: "missing",
              createdByUserId: "user_1",
              creatorProfileId: null,
              lastUsedAt: null,
              createdAt: "2026-04-14T07:00:00.000Z",
              updatedAt: "2026-04-14T08:00:00.000Z",
            },
          ],
        }).success
      ).toBe(false);

      expect(
        createHumanProfileBodySchema.safeParse({
          profileName: "   ",
        }).success
      ).toBe(false);
    });
  });

  describe("space meta schemas", () => {
    it("requires create-space visibility and rejects unknown visibility values", () => {
      expect(
        createSpaceBodySchema.safeParse({
          name: "Ops Room",
          visibility: "private",
        }).success
      ).toBe(true);

      expect(
        createSpaceBodySchema.safeParse({
          name: "Ops Room",
        }).success
      ).toBe(false);

      expect(
        createSpaceBodySchema.safeParse({
          name: "Ops Room",
          visibility: "team",
        }).success
      ).toBe(false);
    });

    it("accepts members-only Spaces without a password", () => {
      expect(
        createSpaceBodySchema.safeParse({
          accessMode: "members_only",
          name: "Private Room",
          visibility: "private",
        }).success
      ).toBe(true);
      expect(
        createSpaceBodySchema.safeParse({
          accessMode: "members_only",
          name: "Private Room",
          password: "secret1",
          visibility: "private",
        }).success
      ).toBe(false);
    });

    it("accepts the explicit Direct Message conversion contract", () => {
      expect(
        convertDirectMessageToSpaceBodySchema.safeParse({
          name: "Felix, Ada, and Scout",
          profileIds: ["agt_11111111-1111-4111-8111-111111111111"],
        }).success
      ).toBe(true);
      expect(
        convertDirectMessageToSpaceBodySchema.safeParse({
          name: "Felix and Ada",
          profileIds: [],
        }).success
      ).toBe(false);
    });

    it("accepts the persisted one-way Direct Message conversion marker", () => {
      expect(
        spaceMetaSchema.safeParse({
          directMessage: {
            convertedAt: "2026-08-07T12:00:00.000Z",
            pairKey: "human-a:human-b",
          },
          organizationId: "org-1",
          spaceId: "space-1",
          visibility: "private",
        }).success
      ).toBe(true);
    });

    it("accepts a canonical meta payload with storage usage", () => {
      const parsed = spaceMetaSchema.safeParse({
        spaceId: "space-1",
        organizationId: "org-1",
        visibility: "private",
        name: "ops-room",
        purpose: "coordinate launch reviews",
        creator: {
          profileId: HUMAN_PROFILE_ID,
          profileName: "Felix",
          kind: "human",
        },
        accessMode: "public",
        passwordProtected: false,
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:01:00.000Z",
        storageUsage: {
          usedBytes: 2_101_248,
          softLimitBytes: 9 * 1024 * 1024 * 1024,
          usagePercent: 24,
        },
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects Space guide updates longer than 100,000 characters", () => {
      expect(MAX_SPACE_GUIDE_LENGTH).toBe(100_000);
      expect(
        patchSpaceMetaBodySchema.safeParse({
          guide: "g".repeat(100_000),
        }).success
      ).toBe(true);
      expect(
        patchSpaceMetaBodySchema.safeParse({
          guide: "g".repeat(100_001),
        }).success
      ).toBe(false);
    });

    it("normalizes valid Space name updates and rejects invalid names", () => {
      expect(
        patchSpaceMetaBodySchema.safeParse({
          name: "  Launch Room  ",
        })
      ).toEqual({
        success: true,
        data: { name: "Launch Room" },
      });
      expect(patchSpaceMetaBodySchema.safeParse({ name: "   " }).success).toBe(
        false
      );
      expect(
        patchSpaceMetaBodySchema.safeParse({
          name: "n".repeat(MAX_SPACE_NAME_LENGTH + 1),
        }).success
      ).toBe(false);
    });

    it("rejects creator profileId when kind and runtime id shape disagree", () => {
      expect(
        spaceMetaSchema.safeParse({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          creator: {
            profileId: AGENT_PROFILE_ID,
            profileName: "Felix",
            kind: "human",
          },
        }).success
      ).toBe(false);

      expect(
        spaceMetaSchema.safeParse({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          creator: {
            profileId: HUMAN_PROFILE_ID,
            profileName: "Ops Bot",
            kind: "agent",
          },
        }).success
      ).toBe(false);
    });

    it("rejects invalid storage usage payloads", () => {
      expect(
        spaceStorageUsageSchema.safeParse({
          usedBytes: -1,
          softLimitBytes: 1024,
          usagePercent: 1,
        }).success
      ).toBe(false);

      expect(
        spaceMetaSchema.safeParse({
          spaceId: "space-1",
          organizationId: "org-1",
          visibility: "private",
          storageUsage: {
            usedBytes: 1024,
            softLimitBytes: 0,
            usagePercent: 50,
          },
        }).success
      ).toBe(false);
    });
  });

  describe("organization Space directory schemas", () => {
    it("keeps the original Organization Space directory response unchanged", () => {
      const parsed = organizationSpaceDirectoryResponseSchema.safeParse({
        organizationId: "org-1",
        generatedAt: "2026-07-04T00:00:00.000Z",
        spaces: [
          {
            spaceId: "space-1",
            name: "Launch Room",
            organizationId: "org-1",
            visibility: "public",
            joined: false,
            lastJoinedAt: null,
            spaceCreatedAt: "2026-07-04T00:00:00.000Z",
            spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
            updatedAt: "2026-07-04T00:02:00.000Z",
          },
        ],
      });

      expect(parsed.success).toBe(true);
      expect(
        organizationSpaceDirectoryResponseSchema.safeParse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          spaces: [
            {
              activeMemberCount: 8,
              spaceId: "space-1",
              name: "Launch Room",
              organizationId: "org-1",
              visibility: "public",
              joined: false,
              lastJoinedAt: null,
              spaceCreatedAt: "2026-07-04T00:00:00.000Z",
              spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
              updatedAt: "2026-07-04T00:02:00.000Z",
            },
          ],
        }).success
      ).toBe(false);
    });

    it("accepts the versioned member-count directory and preserves unknown counts", () => {
      const parsed =
        organizationSpaceDirectoryWithMemberCountsResponseSchema.safeParse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          spaces: [
            {
              activeMemberCount: null,
              spaceId: "space-1",
              name: "Launch Room",
              organizationId: "org-1",
              visibility: "public",
              joined: false,
              lastJoinedAt: null,
              spaceCreatedAt: "2026-07-04T00:00:00.000Z",
              spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
              updatedAt: "2026-07-04T00:02:00.000Z",
            },
          ],
        });

      expect(parsed.success).toBe(true);
      expect(parsed.data?.spaces[0]?.activeMemberCount).toBeNull();
    });

    it("rejects Organization Space directory items without org visibility", () => {
      const parsed = organizationSpaceDirectoryResponseSchema.safeParse({
        organizationId: "org-1",
        generatedAt: "2026-07-04T00:00:00.000Z",
        spaces: [
          {
            spaceId: "space-1",
            name: "Launch Room",
            organizationId: "org-1",
            joined: false,
            lastJoinedAt: null,
            spaceCreatedAt: "2026-07-04T00:00:00.000Z",
            spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
            updatedAt: "2026-07-04T00:02:00.000Z",
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe("account Space index organization fields", () => {
    const accountSpaceIndexItem = {
      creatorKind: "human",
      creatorOwnerUserId: "user-1",
      creatorProfileId: HUMAN_PROFILE_ID,
      creatorProfileName: "Felix",
      gatewayHost: "localhost:8080",
      joinedProfiles: [
        {
          lastJoinedAt: "2026-07-04T00:00:00.000Z",
          pinnedAt: null,
          profileId: HUMAN_PROFILE_ID,
          profileName: "Felix",
        },
      ],
      lastJoinedAt: "2026-07-04T00:00:00.000Z",
      lastSeenTs: null,
      openProfileId: HUMAN_PROFILE_ID,
      openProfileName: "Felix",
      organizationId: "org-1",
      pinnedAt: null,
      pinnedProfileIds: [],
      spaceCreatedAt: "2026-07-04T00:00:00.000Z",
      spaceId: "space-1",
      spaceName: "Launch Room",
      spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
      status: "active",
      updatedAt: "2026-07-04T00:02:00.000Z",
      visibility: "private",
    };

    it("requires Organization ownership and visibility on every account Space index item", () => {
      expect(
        accountSpaceIndexItemSchema.safeParse(accountSpaceIndexItem).success
      ).toBe(true);
      expect(
        accountSpaceIndexItemSchema.safeParse({
          ...accountSpaceIndexItem,
          organizationId: undefined,
        }).success
      ).toBe(false);
      expect(
        accountSpaceIndexItemSchema.safeParse({
          ...accountSpaceIndexItem,
          visibility: undefined,
        }).success
      ).toBe(false);
    });

    it("accepts account Space index responses with Organization fields", () => {
      const parsed = accountSpaceIndexResponseSchema.safeParse({
        pinnedItems: [accountSpaceIndexItem],
        spaceItems: [
          {
            ...accountSpaceIndexItem,
            pinnedAt: null,
            pinnedProfileIds: [],
            spaceId: "space-2",
            visibility: "public",
          },
        ],
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe("space contract schemas", () => {
    const contractFields = {
      dispatchPolicy: {
        mode: "mention_only",
      },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: {
        mode: "all_final_results",
      },
      spaceNote: "Use this space as a thin collaboration layer.",
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    } as const;

    it("accepts the canonical PUT body", () => {
      expect(putSpaceContractBodySchema.safeParse(contractFields).success).toBe(
        true
      );
    });

    it("narrows old client mixed action lists without granting a replacement permission", () => {
      expect(
        putSpaceContractBodySchema.parse(contractFields).allowedActions
      ).toEqual(["post_message", "stay_silent"]);
      expect(
        patchSpaceContractBodySchema.parse({
          allowedActions: ["post_status", "stay_silent"],
        }).allowedActions
      ).toEqual(["stay_silent"]);
      expect(
        patchSpaceContractBodySchema.safeParse({
          allowedActions: ["post_status"],
        }).success
      ).toBe(false);
      expect(
        putSpaceContractBodySchema.safeParse({
          ...contractFields,
          allowedActions: ["post_status"],
        }).success
      ).toBe(false);
      expect(
        patchSpaceContractBodySchema.parse({ publicationMode: "collaboration" })
      ).not.toHaveProperty("allowedActions");
      const stored = {
        ...contractFields,
        version: 1,
        updatedAt: "2026-03-19T00:00:00.000Z",
        updatedBy: HUMAN_PROFILE_ID,
        allowedActions: ["post_status"],
      };
      expect(
        getSpaceContractResponseSchema.parse(stored).allowedActions
      ).toEqual(["post_status"]);
    });

    it("accepts a canonical PATCH body and rejects an empty patch", () => {
      expect(
        patchSpaceContractBodySchema.safeParse({
          publicationMode: "raw_context_sharing",
          allowedActions: ["post_status", "stay_silent"],
        }).success
      ).toBe(true);

      expect(patchSpaceContractBodySchema.safeParse({}).success).toBe(false);
    });

    it("accepts the canonical GET/PUT response shape", () => {
      const contract = {
        version: 2,
        updatedAt: "2026-03-19T00:00:00.000Z",
        updatedBy: HUMAN_PROFILE_ID,
        ...contractFields,
      };

      expect(getSpaceContractResponseSchema.safeParse(contract).success).toBe(
        true
      );
      expect(putSpaceContractResponseSchema.safeParse(contract).success).toBe(
        true
      );
      expect(patchSpaceContractResponseSchema.safeParse(contract).success).toBe(
        true
      );
    });

    it("rejects invalid publication controls and unexpected keys", () => {
      expect(
        putSpaceContractBodySchema.safeParse({
          ...contractFields,
          publicationMode: "status_only",
        }).success
      ).toBe(false);

      expect(
        putSpaceContractBodySchema.safeParse({
          ...contractFields,
          extra: true,
        }).success
      ).toBe(false);
    });
  });

  describe("space status schemas", () => {
    it("accepts and rejects the shared space route params shape", () => {
      expect(
        spaceRouteParamsSchema.safeParse({
          spaceId: "space-1",
        }).success
      ).toBe(true);

      expect(
        spaceRouteParamsSchema.safeParse({
          spaceId: "   ",
        }).success
      ).toBe(false);

      expect(
        spaceRouteParamsSchema.safeParse({
          spaceId: "space-1",
          extra: true,
        }).success
      ).toBe(false);
    });

    it("accepts the canonical space status request and response", () => {
      expect(
        getSpaceStatusInputSchema.safeParse({
          spaceId: "space-1",
        }).success
      ).toBe(true);

      const statusResponse = getSpaceStatusResponseSchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-21T00:00:00.000Z",
        name: "phase-5b-room",
        centerAgentProfileId: AGENT_PROFILE_ID,
        organizationVisibility: "private",
        accessMode: "protected",
        passwordProtected: true,
        dispatchPolicy: { mode: "mention_only" },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: { mode: "all_final_results" },
        entryBrief: "default",
        dispatchBrief: "default",
        members: {
          totalCount: 3,
          humanCount: 1,
          agentCount: 2,
          liveNowCount: 2,
          wakeableAgentCount: 0,
          offlineAgentCount: 0,
          liveHumanCount: 1,
          liveAgentCount: 1,
        },
        latestVisibleUpdate: {
          signalId: "sig-status-1",
          signalType: "signal.status",
          createdAt: "2026-03-21T00:00:00.000Z",
          actorProfileId: AGENT_PROFILE_ID,
          actorName: "hi-agent",
          previewText: "Status update",
        },
      });
      expect(statusResponse.success).toBe(true);
      if (!statusResponse.success) {
        return;
      }
      expect(statusResponse.data.centerAgentProfileId).toBe(AGENT_PROFILE_ID);
      expect(statusResponse.data.organizationVisibility).toBe("private");
    });

    it("uses one shared policy for a newly created Space's initial access", () => {
      expect(resolveInitialSpaceAccessMode("public")).toBe("members_only");
      expect(resolveInitialSpaceAccessMode("private")).toBe("members_only");
    });

    it("bounds status previews received from older Core deployments", () => {
      const longPreview = `${"a".repeat(238)}😀tail-that-must-not-leak`;
      const parsed = getSpaceStatusResponseSchema.parse({
        spaceId: "space-1",
        generatedAt: "2026-03-21T00:00:00.000Z",
        accessMode: "members_only",
        passwordProtected: false,
        dispatchPolicy: { mode: "mention_only" },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: { mode: "all_final_results" },
        entryBrief: "default",
        dispatchBrief: "default",
        members: {
          totalCount: 1,
          humanCount: 1,
          agentCount: 0,
          liveNowCount: 0,
          liveHumanCount: 0,
          liveAgentCount: 0,
        },
        latestVisibleUpdate: {
          signalId: "sig-status-long",
          signalType: "signal.text",
          createdAt: "2026-03-21T00:00:00.000Z",
          actorProfileId: "11111111-1111-4111-8111-111111111111",
          previewText: longPreview,
        },
      });

      expect(parsed.latestVisibleUpdate?.previewText).toHaveLength(239);
      expect(parsed.latestVisibleUpdate?.previewText).toBe(
        `${"a".repeat(238)}…`
      );
      expect(parsed.latestVisibleUpdate?.previewText).not.toContain("tail");
    });

    it("preserves Space status compatibility counts without using them as status truth", () => {
      const parsed = getSpaceStatusResponseSchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-21T00:00:00.000Z",
        name: "phase-5b-room",
        accessMode: "protected",
        passwordProtected: true,
        dispatchPolicy: { mode: "mention_only" },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: { mode: "all_final_results" },
        entryBrief: "default",
        dispatchBrief: "default",
        members: {
          totalCount: 3,
          humanCount: 1,
          agentCount: 2,
          liveNowCount: 2,
          wakeableAgentCount: 0,
          offlineAgentCount: 0,
          liveHumanCount: 1,
          liveAgentCount: 1,
        },
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.members).toEqual({
        totalCount: 3,
        humanCount: 1,
        agentCount: 2,
        liveNowCount: 2,
        wakeableAgentCount: 0,
        offlineAgentCount: 0,
        liveHumanCount: 1,
        liveAgentCount: 1,
      });
    });

    it("allows public view with password-gated join to remain view-public", () => {
      expect(
        getSpaceStatusResponseSchema.safeParse({
          spaceId: "space-1",
          generatedAt: "2026-03-21T00:00:00.000Z",
          name: "share-room",
          accessMode: "public_view_join_password",
          passwordProtected: false,
          dispatchPolicy: { mode: "mention_only" },
          publicationMode: "collaboration",
          allowedActions: ["post_message", "post_status", "stay_silent"],
          resultArchivePolicy: { mode: "all_final_results" },
          entryBrief: "default",
          dispatchBrief: "default",
          members: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            liveNowCount: 0,
            wakeableAgentCount: 0,
            offlineAgentCount: 0,
            liveHumanCount: 0,
            liveAgentCount: 0,
          },
        }).success
      ).toBe(true);
    });

    it("rejects invalid status responses", () => {
      expect(
        getSpaceStatusResponseSchema.safeParse({
          spaceId: "space-1",
          generatedAt: "2026-03-21T00:00:00.000Z",
          accessMode: "public",
          passwordProtected: false,
          dispatchPolicy: { mode: "mention_only" },
          publicationMode: "collaboration",
          allowedActions: ["post_message"],
          resultArchivePolicy: { mode: "all_final_results" },
          entryBrief: "default",
          dispatchBrief: "default",
          members: {
            totalCount: 1,
            humanCount: 1,
            agentCount: 0,
            liveNowCount: 0,
          },
        }).success
      ).toBe(false);
    });
  });

  describe("space updates schemas", () => {
    const signal = {
      v: 1,
      id: "sig-1",
      spaceId: "space-1",
      ts: 123,
      profile: {
        kind: "human",
        profileId: HUMAN_PROFILE_ID,
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text: "hello",
      },
    } as const;

    it("normalizes the default updates query shape", () => {
      const result = getSpaceUpdatesInputSchema.safeParse({
        spaceId: "space-1",
        afterSignalId: "sig-anchor-1",
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        spaceId: "space-1",
        afterSignalId: "sig-anchor-1",
        limit: SPACE_UPDATES_DEFAULT_LIMIT,
      });
    });

    it("rejects invalid updates query values", () => {
      expect(
        getSpaceUpdatesInputSchema.safeParse({
          spaceId: "space-1",
          afterSignalId: "",
        }).success
      ).toBe(false);

      expect(
        getSpaceUpdatesInputSchema.safeParse({
          spaceId: "space-1",
          afterSignalId: "sig-anchor-1",
          limit: String(SPACE_UPDATES_MAX_LIMIT + 1),
        }).success
      ).toBe(false);
    });

    it("accepts the canonical updates response shape", () => {
      expect(
        getSpaceUpdatesResponseSchema.safeParse({
          signals: [signal],
        }).success
      ).toBe(true);
    });
  });

  describe("space signal post schemas", () => {
    const wakeMessageEnvelope = {
      activationTargets: [AGENT_PROFILE_ID],
      referenceTargets: [],
      text: "@Codex Agent(wake) hello",
    };

    it("keeps normal signal posts nullable so Core can enforce Web Wake clientMessageId by origin", () => {
      expect(
        postNormalMessageBodySchema.safeParse({
          text: "@Codex Agent(wake) hello",
          messageEnvelope: wakeMessageEnvelope,
        }).success
      ).toBe(true);
    });

    it("defines explicit signal authoring policies", () => {
      expect(spaceSignalAuthoringPolicySchema.options).toEqual([
        "user_authored",
        "system_emitted",
        "legacy_nullable",
      ]);
    });

    it("requires clientMessageId only for user-authored Wake posts", () => {
      const userWake = validateSpaceSignalClientMessageIdPolicy({
        authoringPolicy: "user_authored",
        messageEnvelope: wakeMessageEnvelope,
      });
      expect(userWake).toEqual({
        ok: false,
        code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
        createsWakeDispatch: true,
        message:
          "Wake requests from user-authored signal posts require clientMessageId.",
        requiresClientMessageId: true,
      });

      expect(
        validateSpaceSignalClientMessageIdPolicy({
          authoringPolicy: "user_authored",
          messageEnvelope: wakeMessageEnvelope,
          meta: { clientMessageId: "client-message-1" },
        })
      ).toEqual({
        ok: true,
        createsWakeDispatch: true,
        requiresClientMessageId: true,
      });

      expect(
        validateSpaceSignalClientMessageIdPolicy({
          authoringPolicy: "user_authored",
        })
      ).toEqual({
        ok: true,
        createsWakeDispatch: false,
        requiresClientMessageId: false,
      });

      expect(
        validateSpaceSignalClientMessageIdPolicy({
          authoringPolicy: "system_emitted",
          messageEnvelope: wakeMessageEnvelope,
        })
      ).toEqual({
        ok: true,
        createsWakeDispatch: true,
        requiresClientMessageId: false,
      });

      expect(
        validateSpaceSignalClientMessageIdPolicy({
          authoringPolicy: "legacy_nullable",
          messageEnvelope: wakeMessageEnvelope,
        })
      ).toEqual({
        ok: true,
        createsWakeDispatch: true,
        requiresClientMessageId: false,
      });

      expect(
        validateSpaceSignalClientMessageIdPolicy({
          authoringPolicy: undefined,
          messageEnvelope: wakeMessageEnvelope,
        })
      ).toEqual({
        ok: false,
        code: SPACE_SIGNAL_AUTHORING_POLICY_REQUIRED_ERROR_CODE,
        createsWakeDispatch: true,
        message:
          "Signal posts must declare authoringPolicy before clientMessageId policy validation.",
        requiresClientMessageId: false,
      });
    });

    it("requires clientMessageId for thread signal posts", () => {
      expect(
        postSpaceThreadSignalBodySchema.safeParse({
          text: "@Codex Agent(wake) hello",
          messageEnvelope: wakeMessageEnvelope,
        }).success
      ).toBe(false);

      expect(
        postSpaceThreadSignalBodySchema.safeParse({
          text: "@Codex Agent(wake) hello",
          messageEnvelope: wakeMessageEnvelope,
          clientMessageId: "client-message-1",
        }).success
      ).toBe(true);
    });
  });

  describe("space dispatch result schemas", () => {
    const textResult = {
      resultRef: "dispatch-result:result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: AGENT_PROFILE_ID,
      actorName: "hi-agent",
      replyToSignalId: "sig-1",
      publishedSignalId: "sig-2",
      publicOutcome: "post_message",
      resultKind: "text",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-1",
        text: "done",
      },
      finalText: "done",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
      },
      runtimeWorkspace: {
        path: "/tmp/runtime-workspace",
        fingerprint: "sha256:runtime-workspace-1",
      },
      dispatchExecution: {
        agentControllerConversationResume: {
          status: "continued",
        },
        localRuntimeContext: {
          status: "reused",
          reason: null,
        },
        bootstrap: {
          reason: null,
          status: "applied",
        },
      },
      createdAt: "2026-03-21T00:00:00.000Z",
    } as const;

    it("accepts exactly one result selector", () => {
      expect(
        getSpaceDispatchResultInputSchema.safeParse({
          spaceId: "space-1",
          dispatchId: "dispatch-1",
        }).success
      ).toBe(true);

      expect(
        getSpaceDispatchResultInputSchema.safeParse({
          spaceId: "space-1",
          resultRef: "dispatch-result:result-1",
        }).success
      ).toBe(true);
    });

    it("rejects missing or duplicate result selectors", () => {
      expect(
        getSpaceDispatchResultInputSchema.safeParse({
          spaceId: "space-1",
        }).success
      ).toBe(false);

      expect(
        getSpaceDispatchResultInputSchema.safeParse({
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          resultRef: "dispatch-result:result-1",
        }).success
      ).toBe(false);
    });

    it("accepts the canonical dispatch result response shape", () => {
      expect(
        getSpaceDispatchResultResponseSchema.safeParse(textResult).success
      ).toBe(true);
    });

    it("rejects legacy dispatch result conversation lifecycle facts", () => {
      expect(
        getSpaceDispatchResultResponseSchema.safeParse({
          ...textResult,
          conversationLifecycle: {
            compatibilityAction: "reuse",
            compatibilityReason: "compatible",
            continuityStatus: "stable_resume",
            bootstrapApplied: true,
            bootstrapReason: null,
            bootstrapTemplateVersion: "compact-dispatch-bootstrap-v1",
            bootstrapContentFingerprint: "sha256:bootstrap",
          },
        }).success
      ).toBe(false);
    });
  });

  describe("space dispatch lookup schemas", () => {
    it("accepts a canonical lookup query with optional target profile", () => {
      expect(
        getSpaceDispatchLookupInputSchema.safeParse({
          spaceId: "space-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: AGENT_PROFILE_ID,
        }).success
      ).toBe(true);
    });

    it("accepts a client-message lookup query", () => {
      expect(
        getSpaceDispatchLookupInputSchema.safeParse({
          spaceId: "space-1",
          clientMessageId: "client-message-1",
        }).success
      ).toBe(true);
    });

    it("rejects missing or blank lookup selectors", () => {
      expect(
        getSpaceDispatchLookupInputSchema.safeParse({
          spaceId: "space-1",
          sourceSignalId: "",
        }).success
      ).toBe(false);

      expect(
        getSpaceDispatchLookupInputSchema.safeParse({
          spaceId: "",
          sourceSignalId: "sig-source-1",
        }).success
      ).toBe(false);

      expect(
        getSpaceDispatchLookupInputSchema.safeParse({
          spaceId: "space-1",
          sourceSignalId: "sig-source-1",
          clientMessageId: "client-message-1",
        }).success
      ).toBe(false);
    });

    it("accepts the canonical lookup response shape", () => {
      expect(
        getSpaceDispatchLookupResponseSchema.safeParse({
          query: {
            spaceId: "space-1",
            sourceSignalId: "sig-source-1",
            clientMessageId: null,
            targetProfileId: AGENT_PROFILE_ID,
          },
          matches: [
            {
              dispatchId: "dispatch-1",
              sourceSignalId: "sig-source-1",
              targetProfileId: AGENT_PROFILE_ID,
              status: "dispatching",
              attemptCount: 2,
              latestAttemptId: "attempt-2",
              latestAttemptStatus: "waiting_result",
              latestAttemptErrorCode: null,
              latestAttemptErrorMessage: null,
            },
          ],
        }).success
      ).toBe(true);
    });
  });

  describe("listSignalsQuerySchema", () => {
    it("accepts literal message search and rejects incompatible timeline filters and unsafe cursors", () => {
      const read = (query: string) =>
        listSignalsQuerySchema.safeParse(
          readListSignalsQueryRawValues(new URLSearchParams(query))
        );
      expect(read("q=invoice&limit=30").success).toBe(true);
      expect(read("q=a&limit=30").success).toBe(true);
      for (const query of [
        "q=invoice&recent=true",
        "q=invoice&aroundSignalId=message",
        "q=invoice&cursor=9007199254740992",
        "q=&limit=30",
      ]) {
        expect(read(query).success).toBe(false);
      }
    });

    it("allows short queries only when search is scoped to one Space", () => {
      expect(
        messageSearchQuerySchema.safeParse({ q: "a", spaceId: "space-1" })
          .success
      ).toBe(true);
      expect(messageSearchQuerySchema.safeParse({ q: "ab" }).success).toBe(
        false
      );
      expect(messageSearchQuerySchema.safeParse({ q: "abc" }).success).toBe(
        true
      );
    });
    it("reads raw query values from URLSearchParams", () => {
      const params = new URLSearchParams(
        "afterTs=1&cursor=cursor-1&limit=&recent=true&afterSignalId=sig-after&aroundSignalId=sig-around&beforeCount=2&afterCount=3&fromProfileId=human-1&fromProfileId=agent-1&signalType=signal.text&signalType=signal.status"
      );

      expect(readListSignalsQueryRawValues(params)).toEqual({
        afterTs: "1",
        cursor: "cursor-1",
        limit: "",
        recent: "true",
        afterSignalId: "sig-after",
        aroundSignalId: "sig-around",
        beforeCount: "2",
        afterCount: "3",
        fromProfileIds: ["human-1", "agent-1"],
        signalTypes: ["signal.text", "signal.status"],
        hasLimit: true,
      });
    });

    it("keeps raw query absence and duplicate single-value semantics stable", () => {
      expect(readListSignalsQueryRawValues(new URLSearchParams())).toEqual({
        afterTs: null,
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: false,
      });

      const duplicateParams = new URLSearchParams(
        "afterTs=1&afterTs=2&limit=10&limit=20"
      );

      expect(readListSignalsQueryRawValues(duplicateParams)).toMatchObject({
        afterTs: "1",
        limit: "10",
        hasLimit: true,
      });
    });

    it("shares anchored history semantics with the CLI helper", () => {
      expect(
        normalizeListSignalsReadQuerySemantics({
          recentOnly: false,
          hasExplicitLimit: true,
          limit: 0,
          afterSignalId: "sig-anchor-1",
          aroundSignalId: null,
          beforeCount: null,
          afterCount: null,
        })
      ).toMatchObject({
        includeLimit: true,
        limit: 0,
        afterSignalId: "sig-anchor-1",
      });

      expect(() =>
        normalizeListSignalsReadQuerySemantics({
          recentOnly: false,
          hasExplicitLimit: true,
          limit: 10,
          afterSignalId: "sig-anchor-1",
          aroundSignalId: "sig-anchor-2",
          beforeCount: null,
          afterCount: null,
        })
      ).toThrow("Cannot use both afterSignalId and aroundSignalId.");
    });

    it("normalizes valid query values", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: " 42 ",
        cursor: "  cursor-1 ",
        limit: " 20 ",
        recent: "TRUE",
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        afterTs: 42,
        cursor: "cursor-1",
        limit: 20,
        recentOnly: true,
        useCursorResponse: true,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
      });
    });

    it("rejects invalid afterTs", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: "oops",
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: false,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid limit", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "x",
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });
      expect(result.success).toBe(false);
    });

    it("keeps hasLimit semantics for empty limit value", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "",
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data.limit).toBe(200);
      expect(result.data.useCursorResponse).toBe(true);
    });

    it("keeps history-mode semantics when query has no cursor inputs", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: false,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data.useCursorResponse).toBe(false);
    });

    it("clamps max limit and defaults zero to catch-up default outside anchored after mode", () => {
      const clamped = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "9999",
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });
      expect(clamped.success).toBe(true);
      if (clamped.success) {
        expect(clamped.data.limit).toBe(500);
      }

      const zero = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "0",
        recent: null,
        afterSignalId: null,
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });
      expect(zero.success).toBe(true);
      if (zero.success) {
        expect(zero.data.limit).toBe(200);
      }

      const anchoredZero = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "0",
        recent: null,
        afterSignalId: "sig-anchor-1",
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });
      expect(anchoredZero.success).toBe(true);
      if (anchoredZero.success) {
        expect(anchoredZero.data.limit).toBe(0);
        expect(anchoredZero.data.afterSignalId).toBe("sig-anchor-1");
      }
    });

    it("normalizes anchored and filtered history query values", () => {
      const result = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "10",
        recent: null,
        afterSignalId: " sig-anchor-1 ",
        aroundSignalId: null,
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [" human-1 ", "human-1", "human-2"],
        signalTypes: ["signal.text", "signal.status", "signal.text"],
        hasLimit: true,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data.afterSignalId).toBe("sig-anchor-1");
      expect(result.data.fromProfileIds).toEqual(["human-1", "human-2"]);
      expect(result.data.signalTypes).toEqual(["signal.text", "signal.status"]);
    });

    it("accepts around-signal windows and rejects invalid anchor combinations", () => {
      const validAround = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: null,
        aroundSignalId: "sig-anchor-2",
        beforeCount: "2",
        afterCount: "3",
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: false,
      });
      expect(validAround.success).toBe(true);

      const exactAnchor = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: null,
        aroundSignalId: "sig-anchor-exact",
        beforeCount: "0",
        afterCount: "0",
        fromProfileIds: [],
        signalTypes: ["signal.text"],
        hasLimit: false,
      });
      expect(exactAnchor.success).toBe(true);

      const invalidMixedAnchors = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: null,
        recent: null,
        afterSignalId: "sig-anchor-1",
        aroundSignalId: "sig-anchor-2",
        beforeCount: null,
        afterCount: null,
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: false,
      });
      expect(invalidMixedAnchors.success).toBe(false);

      const invalidAroundLimit = listSignalsQuerySchema.safeParse({
        afterTs: null,
        cursor: null,
        limit: "20",
        recent: null,
        afterSignalId: null,
        aroundSignalId: "sig-anchor-2",
        beforeCount: "2",
        afterCount: "0",
        fromProfileIds: [],
        signalTypes: [],
        hasLimit: true,
      });
      expect(invalidAroundLimit.success).toBe(false);
    });
  });

  describe("catchupResponseSchema", () => {
    it("accepts canonical object shape and defaults nextCursor to null", () => {
      const result = catchupResponseSchema.safeParse({
        signals: [{ id: "evt-1" }, { id: "evt-2" }],
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        signals: [{ id: "evt-1" }, { id: "evt-2" }],
        nextCursor: null,
      });
    });

    it("accepts paged shape and preserves non-empty nextCursor", () => {
      const result = catchupResponseSchema.safeParse({
        signals: [{ id: "evt-1" }],
        nextCursor: " cursor-next ",
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        signals: [{ id: "evt-1" }],
        nextCursor: " cursor-next ",
      });
    });

    it("rejects non-string nextCursor", () => {
      const result = catchupResponseSchema.safeParse({
        signals: [{ id: "evt-1" }],
        nextCursor: 123,
      });

      expect(result.success).toBe(false);
    });

    it("rejects blank nextCursor", () => {
      const result = catchupResponseSchema.safeParse({
        signals: [{ id: "evt-1" }],
        nextCursor: "   ",
      });

      expect(result.success).toBe(false);
    });

    it("rejects legacy array response shape", () => {
      const result = catchupResponseSchema.safeParse([{ id: "evt-1" }]);
      expect(result.success).toBe(false);
    });

    it("rejects object without signals array", () => {
      const result = catchupResponseSchema.safeParse({
        nextCursor: "c-1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects object with unknown keys", () => {
      const result = catchupResponseSchema.safeParse({
        signals: [{ id: "evt-1" }],
        nextCursor: null,
        extra: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("space cursor patch normalization", () => {
    it("normalizes supported patch fields", () => {
      expect(
        normalizeSpaceCursorPatch({
          lastSeenTs: 123,
          role: "  helper  ",
          mentionAlias: "  triage_bot  ",
        })
      ).toEqual({
        ok: true,
        value: {
          lastSeenTs: 123,
          role: "helper",
          mentionAlias: "triage_bot",
        },
      });
    });

    it("fails empty and non-object patch input", () => {
      expect(normalizeSpaceCursorPatch({})).toEqual({
        ok: false,
        message: "Expected lastSeenTs, role or mentionAlias",
      });
      expect(
        normalizeSpaceCursorPatch({
          lastSeenTs: undefined,
          role: undefined,
        })
      ).toEqual({
        ok: false,
        message: "Expected lastSeenTs, role or mentionAlias",
      });
      expect(normalizeSpaceCursorPatch(undefined)).toEqual({
        ok: false,
        message: "Invalid JSON",
      });
    });

    it("normalizes negative and decimal lastSeenTs values", () => {
      expect(normalizeSpaceCursorPatch({ lastSeenTs: -3 })).toEqual({
        ok: true,
        value: {
          lastSeenTs: 0,
        },
      });
      expect(normalizeSpaceCursorPatch({ lastSeenTs: 12.9 })).toEqual({
        ok: true,
        value: {
          lastSeenTs: 12,
        },
      });
    });

    it("omits non-finite lastSeenTs values", () => {
      expect(
        normalizeSpaceCursorPatch({ lastSeenTs: Number.POSITIVE_INFINITY })
      ).toEqual({
        ok: false,
        message: "Expected lastSeenTs, role or mentionAlias",
      });
      expect(
        normalizeSpaceCursorPatch({
          lastSeenTs: Number.NaN,
          role: "helper",
        })
      ).toEqual({
        ok: true,
        value: {
          role: "helper",
        },
      });
    });

    it("fails fields that are present with invalid primitive types", () => {
      expect(normalizeSpaceCursorPatch({ lastSeenTs: "10" })).toEqual({
        ok: false,
        message: "Invalid lastSeenTs",
      });
      expect(normalizeSpaceCursorPatch({ role: 1 })).toEqual({
        ok: false,
        message: "Invalid role",
      });
      expect(normalizeSpaceCursorPatch({ mentionAlias: 1 })).toEqual({
        ok: false,
        message: "Invalid mentionAlias",
      });
    });

    it("keeps blank string fields so Core can clear stored values", () => {
      expect(
        normalizeSpaceCursorPatch({
          role: "   ",
          mentionAlias: "   ",
        })
      ).toEqual({
        ok: true,
        value: {
          role: "",
          mentionAlias: "",
        },
      });
    });
  });

  describe("profileSpaceHistory schemas", () => {
    const VALID_RECORD = {
      profileId: "agt_8f42f9db-bf77-4d4b-8d04-2c69656877e9",
      gatewayHost: "localhost:8080",
      spaceId:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      spaceName: "ops-room",
      creatorProfileId: "agt_8f42f9db-bf77-4d4b-8d04-2c69656877e9",
      creatorKind: "agent",
      spaceCreatedAt: "2026-02-24T00:00:00.000Z",
      spaceUpdatedAt: "2026-02-24T00:00:01.000Z",
      lastJoinedAt: "2026-02-24T00:00:02.000Z",
      lastSeenTs: 123,
      pinnedAt: null,
      status: "active",
      createdAt: "2026-02-24T00:00:03.000Z",
      updatedAt: "2026-02-24T00:00:04.000Z",
    } as const;

    it("accepts canonical history record shape", () => {
      const parsed = profileSpaceHistoryRecordSchema.safeParse(VALID_RECORD);
      expect(parsed.success).toBe(true);
    });

    it("rejects invalid history status", () => {
      const parsed = profileSpaceHistoryRecordSchema.safeParse({
        ...VALID_RECORD,
        status: "disabled",
      });
      expect(parsed.success).toBe(false);
    });

    it("validates list query payload from normalized values", () => {
      const parsed = listProfileSpaceHistoryQuerySchema.safeParse({
        gatewayHost: "  localhost:8080  ",
        status: ["active", "removed"],
        limit: 50,
        pinned: true,
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      expect(parsed.data).toEqual({
        gatewayHost: "localhost:8080",
        status: ["active", "removed"],
        limit: 50,
        pinned: true,
      });
    });

    it("accepts list query payload from raw HTTP query values", () => {
      const parsed = listProfileSpaceHistoryQuerySchema.safeParse({
        gatewayHost: "https://LOCALHOST:8080",
        status: "active",
        limit: "50",
        pinned: "false",
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      expect(parsed.data).toEqual({
        gatewayHost: "localhost:8080",
        status: ["active"],
        limit: 50,
        pinned: false,
      });
    });

    it("rejects list query with invalid pinned filter", () => {
      const parsed = listProfileSpaceHistoryQuerySchema.safeParse({
        gatewayHost: "localhost:8080",
        pinned: "yes",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects list query with out-of-range limit", () => {
      const parsed = listProfileSpaceHistoryQuerySchema.safeParse({
        gatewayHost: "localhost:8080",
        limit: 0,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects list query when gatewayHost includes a path", () => {
      const parsed = listProfileSpaceHistoryQuerySchema.safeParse({
        gatewayHost: "localhost:8080/v1",
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts upsert payload with optional nullable fields", () => {
      const parsed = upsertProfileSpaceHistoryBodySchema.safeParse({
        gatewayHost: "localhost:8080",
        spaceName: null,
        creatorProfileId: null,
        creatorKind: null,
        spaceCreatedAt: null,
        spaceUpdatedAt: null,
        lastJoinedAt: "2026-02-24T00:00:02.000Z",
        lastSeenTs: null,
        pinnedAt: "2026-02-24T00:00:03.000Z",
        status: "active",
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts upsert payload that clears pinnedAt", () => {
      const parsed = upsertProfileSpaceHistoryBodySchema.safeParse({
        gatewayHost: "localhost:8080",
        pinnedAt: null,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects upsert payload with invalid lastSeenTs", () => {
      const parsed = upsertProfileSpaceHistoryBodySchema.safeParse({
        gatewayHost: "localhost:8080",
        lastSeenTs: -1,
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts status patch body payload", () => {
      const parsed = patchProfileSpaceHistoryStatusBodySchema.safeParse({
        gatewayHost: "localhost:8080",
        status: "inaccessible",
        reason: "forbidden",
      });
      expect(parsed.success).toBe(true);
    });

    it("validates list response items", () => {
      const parsed = listProfileSpaceHistoryResponseSchema.safeParse({
        items: [VALID_RECORD],
      });
      expect(parsed.success).toBe(true);
    });

    it("validates upsert response overlay status", () => {
      const parsed = upsertProfileSpaceHistoryResponseSchema.safeParse({
        item: VALID_RECORD,
        spaceIndexOverlay: {
          repairAttempted: true,
          status: "pending",
          updated: false,
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("spacePassword schemas", () => {
    it("accepts the shared Space access modes", () => {
      expect(spaceAccessModeSchema.safeParse("public").success).toBe(true);
      expect(spaceAccessModeSchema.safeParse("members_only").success).toBe(
        true
      );
      expect(
        spaceAccessModeSchema.safeParse("public_view_join_password").success
      ).toBe(true);
      expect(spaceAccessModeSchema.safeParse("protected").success).toBe(true);
      expect(
        spaceAccessModeSchema.safeParse("password_protected").success
      ).toBe(false);
    });

    it("accepts create payload without password", () => {
      const parsed = createSpacePasswordBodySchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it("accepts access mode updates with the optional single Space password", () => {
      const existingPasswordMode = setSpaceAccessModeBodySchema.safeParse({
        accessMode: "public_view_join_password",
      });
      expect(existingPasswordMode.success).toBe(true);

      const lockNewPasswordMode = setSpaceAccessModeBodySchema.safeParse({
        accessMode: "protected",
        allowGuests: true,
        password: "  abc123  ",
        visibility: "public",
      });
      expect(lockNewPasswordMode.success).toBe(true);
      if (lockNewPasswordMode.success) {
        expect(lockNewPasswordMode.data.password).toBe("abc123");
        expect(lockNewPasswordMode.data.allowGuests).toBe(true);
        expect(lockNewPasswordMode.data.visibility).toBe("public");
      }
    });

    it("rejects invalid access mode update payloads", () => {
      expect(
        setSpaceAccessModeBodySchema.safeParse({
          accessMode: "password_protected",
        }).success
      ).toBe(false);
      expect(
        setSpaceAccessModeBodySchema.safeParse({
          accessMode: "protected",
          password: "12345",
        }).success
      ).toBe(false);
    });

    it("accepts create and upsert payload when length is exactly minimum", () => {
      const password = "abc123";

      const createParsed = createSpacePasswordBodySchema.safeParse({
        password,
      });
      expect(createParsed.success).toBe(true);

      const upsertParsed = upsertSpacePasswordBodySchema.safeParse({
        password,
      });
      expect(upsertParsed.success).toBe(true);
    });

    it("normalizes leading and trailing password whitespace", () => {
      const parsed = upsertSpacePasswordBodySchema.safeParse({
        password: "  abc123  ",
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.password).toBe("abc123");
      }
    });

    it("rejects password shorter than minimum length", () => {
      const parsed = spacePasswordSchema.safeParse(
        "a".repeat(SPACE_PASSWORD_MIN_LENGTH - 1)
      );
      expect(parsed.success).toBe(false);
    });

    it("preserves the UTF-16 password length contract for emoji", () => {
      for (const password of ["😀😀😀", "abc😀😀"]) {
        expect(
          createSpacePasswordBodySchema.safeParse({ password }).success
        ).toBe(true);
        expect(
          upsertSpacePasswordBodySchema.safeParse({ password }).success
        ).toBe(true);
      }

      const tooShort = spacePasswordSchema.safeParse("  😀😀  ");
      expect(tooShort.success).toBe(false);
      if (!tooShort.success) {
        expect(tooShort.error.issues[0]).toMatchObject({
          code: "too_small",
          origin: "string",
          minimum: SPACE_PASSWORD_MIN_LENGTH,
          inclusive: true,
        });
      }
    });

    it("rejects non-string password", () => {
      const parsed = upsertSpacePasswordBodySchema.safeParse({
        password: 123_456,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects upsert payload when password is missing", () => {
      const parsed = upsertSpacePasswordBodySchema.safeParse({});
      expect(parsed.success).toBe(false);
    });

    it("accepts passwords with symbols and rejects all-whitespace passwords", () => {
      const symbolParsed = upsertSpacePasswordBodySchema.safeParse({
        password: "a$1!@#",
      });
      expect(symbolParsed.success).toBe(true);

      const spacesParsed = upsertSpacePasswordBodySchema.safeParse({
        password: "      ",
      });
      expect(spacesParsed.success).toBe(false);
    });

    it("accepts passwordProtected state payload", () => {
      const parsed = spacePasswordStateSchema.safeParse({
        passwordProtected: true,
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts access mode state payload", () => {
      const parsed = spaceAccessModeStateSchema.safeParse({
        spaceId: "space-1",
        accessMode: "public_view_join_password",
        passwordProtected: false,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("spaceMembers schemas", () => {
    const VALID_HUMAN = {
      profileId: HUMAN_PROFILE_ID,
      profileName: "Host",
      profileKind: "human",
      mentionAlias: "host",
      status: "active",
      memberSource: "space_creator",
      memberSourceLabel: "Creator",
      addedAt: "2026-03-06T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayName: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: "2026-03-06T00:00:00.000Z",
      lastEnteredAt: "2026-03-06T00:00:00.000Z",
      lastSeenAt: "2026-03-06T00:05:00.000Z",
      lastSeenLabel: "Seen just now",
      liveNow: true,
      ownerUserId: "user-host",
      ownerName: "Host Owner",
    } as const;

    const VALID_AGENT_EXECUTION_READINESS =
      createSpaceMemberAgentExecutionReadiness({
        agentProfileId: AGENT_PROFILE_ID,
        displayState: "ready",
        reasonCodes: [],
      });
    const VALID_AGENT_DAEMON_ROUTE_OBSERVATION = {
      observedAt: "2026-03-06T00:02:00.000Z",
      reasonCode: "online",
      status: "online",
    } as const;

    const VALID_AGENT = {
      profileId: AGENT_PROFILE_ID,
      profileName: "Ops Bot",
      profileKind: "agent",
      mentionAlias: "ops_bot",
      status: "active",
      memberSource: "added_by_member",
      memberSourceLabel: "Added by Felix",
      addedAt: "2026-03-06T00:01:00.000Z",
      removedAt: null,
      createdAt: "2026-03-06T00:01:00.000Z",
      updatedAt: "2026-03-06T00:02:00.000Z",
      addedByProfileId: HUMAN_PROFILE_ID,
      addedByOwnerUserId: "usr-felix",
      addedByDisplayName: "Felix",
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: "2026-03-06T00:02:00.000Z",
      lastSeenLabel: "Seen 3m ago",
      liveNow: false,
      ownerUserId: "usr-felix",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
      runtimeDeviceDisplayName: " Felix's composer ",
      agentControllerConversationId: null,
      workingDirectory: " /tmp/Space Agent ",
      agentWakeAvailability:
        buildAgentAgentWakeAvailability("available_for_wake"),
      ownerWakeDiagnostics: {
        agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
        state: "none",
        agentExecutionReadiness: VALID_AGENT_EXECUTION_READINESS,
        wakeRouteEvidence: VALID_AGENT_DAEMON_ROUTE_OBSERVATION,
        wakeRouteStatus: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          lane: "dev-local",
          lastHeartbeatMs: 1_770_000_000_000,
          leaseEpoch: 1,
          status: "ready",
        },
      },
    } as const;

    it("accepts a lightweight member directory without readiness fields", () => {
      const parsed = spaceMemberDirectorySchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-06T00:05:00.000Z",
        members: [
          {
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            displayName: "Codex Agent",
            primaryMentionLabel: "Codex Agent",
            mentionLabels: ["Codex Agent"],
            mentionAlias: null,
            labelSource: "profile_name",
            lookupTokens: ["codex agent", AGENT_PROFILE_ID],
            preferredLookupToken: "codex agent",
            profileIdShort: "agt_33333",
            allowedRelations: {
              wake: true,
              reference: true,
            },
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentCard: {
              role: "Engineering helper",
              roleDescription: "Helps investigate local development issues.",
            },
            spaceRole: null,
          },
          {
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            displayName: "Felix",
            primaryMentionLabel: "Felix",
            mentionLabels: ["Felix"],
            mentionAlias: null,
            labelSource: "profile_name",
            lookupTokens: ["felix", HUMAN_PROFILE_ID],
            preferredLookupToken: "felix",
            profileIdShort: "11111",
            allowedRelations: {
              wake: false,
              reference: true,
            },
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentCard: null,
            spaceRole: null,
          },
        ],
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(JSON.stringify(parsed.data)).not.toContain("wakeAvailability");
      expect(JSON.stringify(parsed.data)).not.toContain("ownerWakeDiagnostics");
    });

    it("rejects member directory entries that give Wake to a human", () => {
      const parsed = spaceMemberDirectorySchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-06T00:05:00.000Z",
        members: [
          {
            profileId: HUMAN_PROFILE_ID,
            profileKind: "human",
            displayName: "Felix",
            primaryMentionLabel: "Felix",
            mentionLabels: ["Felix"],
            mentionAlias: null,
            labelSource: "profile_name",
            lookupTokens: ["felix"],
            preferredLookupToken: "felix",
            profileIdShort: "11111",
            allowedRelations: {
              wake: true,
              reference: true,
            },
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentCard: null,
            spaceRole: null,
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });

    it("accepts canonical snapshot payload", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 1,
          offlineAgentCount: 0,
        },
        humans: [VALID_HUMAN],
        agents: [VALID_AGENT],
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      expect(parsed.data.humans[0]?.ownerUserId).toBe("user-host");
      expect(parsed.data.humans[0]?.ownerName).toBe("Host Owner");
      expect(parsed.data.humans[0]?.mentionAlias).toBe("host");
      expect(parsed.data.agents[0]?.mentionAlias).toBe("ops_bot");
      expect(parsed.data.agents[0]?.workingDirectory).toBe(
        " /tmp/Space Agent "
      );
      expect(parsed.data.agents[0]?.runtimeDeviceDisplayName).toBe(
        "Felix's composer"
      );
      expect(
        parsed.data.agents[0]?.ownerWakeDiagnostics?.wakeRouteEvidence
      ).toEqual({
        observedAt: "2026-03-06T00:02:00.000Z",
        reasonCode: "online",
        status: "online",
      });
    });

    it("ignores additive fields on Space members snapshot responses", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 1,
          offlineAgentCount: 0,
          futureSummaryField: true,
        },
        humans: [{ ...VALID_HUMAN, futureHumanField: "ignored" }],
        agents: [{ ...VALID_AGENT, futureAgentField: "ignored" }],
        futureTopLevelField: "ignored",
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data).not.toHaveProperty("futureTopLevelField");
      expect(parsed.data.summary).not.toHaveProperty("futureSummaryField");
      expect(parsed.data.humans[0]).not.toHaveProperty("futureHumanField");
      expect(parsed.data.agents[0]).not.toHaveProperty("futureAgentField");
    });

    it("accepts unavailable owner Wake diagnostics observations without collapsing them into offline", () => {
      const agentExecutionReadiness = createSpaceMemberAgentExecutionReadiness({
        agentProfileId: AGENT_PROFILE_ID,
        displayState: "not_ready",
        reasonCodes: ["route.unavailable"],
      });
      const daemonRouteObservation = {
        observedAt: "2026-03-06T00:02:00.000Z",
        reasonCode: "lookup_failed",
        status: "unavailable",
      } as const;
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 0,
          offlineAgentCount: 0,
          unavailableAgentCount: 1,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            agentWakeAvailability: buildAgentAgentWakeAvailability(
              "unavailable_for_wake"
            ),
            ownerWakeDiagnostics: {
              agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
              state: "action_required",
              agentExecutionReadiness,
              wakeRouteEvidence: daemonRouteObservation,
              wakeRouteStatus: {
                status: "unavailable",
              },
            },
          },
        ],
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }

      expect(
        parsed.data.agents[0]?.ownerWakeDiagnostics?.wakeRouteEvidence
      ).toEqual(daemonRouteObservation);
    });

    it("counts public wakeability from agentWakeAvailability, not owner Wake diagnostics facts", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 0,
          offlineAgentCount: 0,
          unavailableAgentCount: 1,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            agentWakeAvailability: buildAgentAgentWakeAvailability(
              "unavailable_for_wake"
            ),
            ownerWakeDiagnostics: {
              agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
              state: "none",
              agentExecutionReadiness: VALID_AGENT_EXECUTION_READINESS,
              wakeRouteEvidence: VALID_AGENT_DAEMON_ROUTE_OBSERVATION,
              wakeRouteStatus: {
                connectionGeneration: 1,
                daemonSessionId: "daemon-session-1",
                deviceId: "device-1",
                lane: "dev-local",
                lastHeartbeatMs: 1_770_000_000_000,
                leaseEpoch: 1,
                status: "ready",
              },
            },
          },
        ],
      });

      expect(parsed.success).toBe(true);
      if (!parsed.success) {
        return;
      }
      expect(parsed.data.summary.wakeableAgentCount).toBe(0);
      expect(parsed.data.summary.offlineAgentCount).toBe(0);
      expect(parsed.data.summary.unavailableAgentCount).toBe(1);
    });

    it("rejects legacy local control facts", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 1,
          offlineAgentCount: 0,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            agentExecutionReadiness: VALID_AGENT_EXECUTION_READINESS,
            daemonRouteObservation: VALID_AGENT_DAEMON_ROUTE_OBSERVATION,
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects legacy public reply and owner diagnostics fields", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 1,
          offlineAgentCount: 0,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            publicReplyPresence: { status: "ready" },
            viewerLocalControl: {
              agentExecutionReadiness: VALID_AGENT_EXECUTION_READINESS,
              daemonRouteObservation: VALID_AGENT_DAEMON_ROUTE_OBSERVATION,
            },
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });

    it("accepts explicit null mentionAlias values on both human and agent snapshots", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
          wakeableAgentCount: 1,
          offlineAgentCount: 0,
        },
        humans: [{ ...VALID_HUMAN, mentionAlias: null }],
        agents: [{ ...VALID_AGENT, mentionAlias: null }],
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects overlong agent workingDirectory", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            workingDirectory: `/tmp/${"x".repeat(4097)}`,
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects retired legacy wake fields", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 0,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [],
        agents: [{ ...VALID_AGENT, wakeState: "ready" }],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects retired legacy wakeability fields", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 2,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 1,
        },
        humans: [VALID_HUMAN],
        agents: [
          {
            ...VALID_AGENT,
            wakeability: {
              status: "ready",
              reasonCodes: [],
              reasonText: "Legacy route-only ready",
            },
          },
        ],
      });

      expect(parsed.success).toBe(false);
    });

    it("accepts post members body, remove body, add/remove responses, and leave responses", () => {
      const centerAgentBody = addCenterAgentToSpaceBodySchema.safeParse({
        expectedCenterAgentProfileId: AGENT_PROFILE_ID,
      });
      expect(centerAgentBody.success).toBe(true);
      expect(
        addCenterAgentToSpaceBodySchema.safeParse({
          expectedCenterAgentProfileId: HUMAN_PROFILE_ID,
        }).success
      ).toBe(false);

      const directoryProfilesBody =
        addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse({
          directoryProfileIds: [HUMAN_PROFILE_ID, AGENT_PROFILE_ID],
          expectedCenterAgentProfileId: AGENT_PROFILE_ID,
        });
      expect(directoryProfilesBody.success).toBe(true);
      expect(
        addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse({
          directoryProfileIds: [HUMAN_PROFILE_ID, HUMAN_PROFILE_ID],
        }).success
      ).toBe(false);
      expect(
        addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse({
          directoryProfileIds: [HUMAN_PROFILE_ID],
          expectedCenterAgentProfileId: AGENT_PROFILE_ID,
        }).success
      ).toBe(false);

      const body = postSpaceMembersBodySchema.safeParse({
        memberProfileIds: [` ${AGENT_PROFILE_ID} `, SECOND_HUMAN_PROFILE_ID],
      });
      expect(body.success).toBe(true);
      if (body.success) {
        expect(body.data.memberProfileIds).toEqual([
          AGENT_PROFILE_ID,
          SECOND_HUMAN_PROFILE_ID,
        ]);
      }

      const removeBody = removeSpaceMembersBodySchema.safeParse({
        memberProfileIds: [AGENT_PROFILE_ID],
      });
      expect(removeBody.success).toBe(true);

      const response = postSpaceMembersResponseSchema.safeParse({
        addedMemberIds: [AGENT_PROFILE_ID],
        alreadyMemberIds: [HUMAN_PROFILE_ID],
        items: [VALID_HUMAN, VALID_AGENT],
      });
      expect(response.success).toBe(true);

      const removeResponse = removeSpaceMembersResponseSchema.safeParse({
        removedMemberIds: [AGENT_PROFILE_ID],
        alreadyAbsentMemberIds: [SECOND_HUMAN_PROFILE_ID],
      });
      expect(removeResponse.success).toBe(true);

      const leaveResponse = leaveSpaceResponseSchema.safeParse({
        leftProfileId: HUMAN_PROFILE_ID,
        status: "left",
      });
      expect(leaveResponse.success).toBe(true);

      const alreadyAbsentLeaveResponse = leaveSpaceResponseSchema.safeParse({
        leftProfileId: HUMAN_PROFILE_ID,
        status: "already_absent",
      });
      expect(alreadyAbsentLeaveResponse.success).toBe(true);

      const invalidLeaveResponse = leaveSpaceResponseSchema.safeParse({
        leftProfileId: "",
        status: "left",
      });
      expect(invalidLeaveResponse.success).toBe(false);

      const deleteResponse = deleteSpaceResponseSchema.safeParse({
        deleted: true,
        spaceId: SPACE_ID,
      });
      expect(deleteResponse.success).toBe(true);

      const invalidDeleteResponse = deleteSpaceResponseSchema.safeParse({
        deleted: false,
        spaceId: SPACE_ID,
      });
      expect(invalidDeleteResponse.success).toBe(false);

      expect(
        gatewayErrorCodeSchema.safeParse("space.leave_space.creator_forbidden")
          .success
      ).toBe(true);
      expect(gatewayErrorCodeSchema.safeParse("space.forbidden").success).toBe(
        true
      );
      expect(
        gatewayErrorCodeSchema.safeParse("space.password_rate_limited").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.human_confirmation_required")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse(
          "space.wake.client_message_id_required"
        ).success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.wake.handoff_seed_failed")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.wake.target_invalid").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.addressing.target_invalid")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse(
          "space.publication_mode.owner_required"
        ).success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse(
          "space.publication_mode.password_not_configured"
        ).success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.join.human_profile_required")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.join.private").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space.organization_mismatch").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("center_agent.dm_open_failed").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space_task.revision_conflict").success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space_task.result_revision_conflict")
          .success
      ).toBe(true);
      const review = {
        action: "review",
        decision: "accepted",
        expectedRevision: 5,
        operationId: "review-current-result",
      };
      expect(mutateSpaceTaskBodySchema.safeParse(review).success).toBe(false);
      expect(
        mutateSpaceTaskBodySchema.safeParse({
          ...review,
          expectedResultRevision: 2,
        }).success
      ).toBe(true);
      expect(
        spaceTaskDetailOptionsSchema.safeParse({ includeAffordances: true })
          .success
      ).toBe(true);
      expect(
        spaceTaskDetailOptionsSchema.safeParse({ includeAffordances: "1" })
          .success
      ).toBe(false);
      const providerOperation = spaceTaskGitHubIssueOperationId(
        "observe-closed",
        { owner: "o".repeat(39), repo: "r".repeat(100), number: 123_456_789 },
        "tsk_55555555-5555-4555-8555-555555555555",
        "9e230c99-4ed2-411c-862b-3978db60bfb2"
      );
      expect(providerOperation.length).toBeLessThanOrEqual(
        SPACE_TASK_OPERATION_ID_MAX_CHARS
      );
      expect(
        gatewayErrorCodeSchema.safeParse("space_task.operation_conflict")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse("space_task.external_work_item_limit")
          .success
      ).toBe(true);
      expect(
        gatewayErrorCodeSchema.safeParse(
          "space_task.external_work_item_not_found"
        ).success
      ).toBe(true);

      const storedTaskWithoutLinks = spaceTaskSchema.safeParse({
        assignee: null,
        automaticReworkRounds: 0,
        completionConditions: [],
        createdAt: "2026-09-20T00:00:00.000Z",
        createdBy: {
          ownerUserId: "user-avery",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Avery",
        },
        description: null,
        needsHumanDecision: false,
        phase: "to_do",
        requestedBy: {
          ownerUserId: "user-avery",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Avery",
        },
        result: null,
        review: null,
        reviewer: null,
        revision: 1,
        sourceSignalId: null,
        spaceId: SPACE_ID,
        taskId: "tsk_55555555-5555-4555-8555-555555555555",
        threadId: null,
        title: "Ship Tasks",
        updatedAt: "2026-09-20T00:00:00.000Z",
      });
      expect(storedTaskWithoutLinks.success).toBe(true);
      if (storedTaskWithoutLinks.success) {
        expect(storedTaskWithoutLinks.data.externalWorkItems).toEqual([]);
      }

      const resolved = postResolvedSpaceMembersBodySchema.safeParse({
        members: [
          {
            profileId: AGENT_PROFILE_ID,
            profileName: "Ops Bot",
            profileKind: "agent",
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
          },
        ],
      });
      expect(resolved.success).toBe(true);
    });

    it("rejects human snapshot when profileId uses the agent runtime shape", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 1,
          agentCount: 0,
          liveNowCount: 1,
        },
        humans: [{ ...VALID_HUMAN, profileId: AGENT_PROFILE_ID }],
        agents: [],
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects agent snapshot when profileId uses the human runtime shape", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 1,
          humanCount: 0,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [],
        agents: [{ ...VALID_AGENT, profileId: HUMAN_PROFILE_ID }],
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects add-members response when returned profile ids are not runtime ids", () => {
      const parsed = postSpaceMembersResponseSchema.safeParse({
        addedMemberIds: ["not-a-runtime-profile-id"],
        alreadyMemberIds: [HUMAN_PROFILE_ID],
        items: [VALID_HUMAN],
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects resolved members when kind and profileId shape disagree", () => {
      const humanParsed = postResolvedSpaceMembersBodySchema.safeParse({
        members: [
          {
            profileId: AGENT_PROFILE_ID,
            profileName: "Host",
            profileKind: "human",
            ownerUserId: "user-host",
            ownerName: "Host Owner",
            agentControllerRef: null,
          },
        ],
      });
      expect(humanParsed.success).toBe(false);

      const agentParsed = postResolvedSpaceMembersBodySchema.safeParse({
        members: [
          {
            profileId: HUMAN_PROFILE_ID,
            profileName: "Ops Bot",
            profileKind: "agent",
            ownerUserId: "usr-felix",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
          },
        ],
      });
      expect(agentParsed.success).toBe(false);
    });

    it("rejects empty add-members body", () => {
      const parsed = postSpaceMembersBodySchema.safeParse({
        memberProfileIds: [],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects empty remove-members body", () => {
      const parsed = removeSpaceMembersBodySchema.safeParse({
        memberProfileIds: [],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects snapshot when summary drifts from member arrays", () => {
      const parsed = spaceMembersSnapshotSchema.safeParse({
        spaceId: "space-1",
        generatedAt: "2026-03-06T00:05:00.000Z",
        summary: {
          totalCount: 999,
          humanCount: 1,
          agentCount: 1,
          liveNowCount: 0,
        },
        humans: [VALID_HUMAN],
        agents: [VALID_AGENT],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("observability correlation schemas", () => {
    it("accepts canonical wake trace selectors", () => {
      expect(
        observabilityWakeTraceSelectorSchema.safeParse({
          kind: "client_message",
          spaceId: "space-1",
          clientMessageId: "client-message-1",
          targetProfileId: AGENT_PROFILE_ID,
        }).success
      ).toBe(true);

      expect(
        observabilityWakeTraceSelectorSchema.safeParse({
          kind: "dispatch",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
        }).success
      ).toBe(true);
    });

    it("accepts legacy claim lease selectors for stored diagnostic pointers", () => {
      expect(
        observabilityWakeTraceSelectorSchema.safeParse({
          kind: "claim_lease",
          claimLeaseId: "claim-lease-1",
        }).success
      ).toBe(true);
    });

    it("rejects ambiguous or under-scoped wake trace selectors", () => {
      expect(
        observabilityWakeTraceSelectorSchema.safeParse({
          kind: "client_message",
          spaceId: "space-1",
          clientMessageId: "client-message-1",
        }).success
      ).toBe(false);

      expect(
        observabilityWakeTraceSelectorSchema.safeParse({
          kind: "dispatch",
          dispatchId: "dispatch-1",
        }).success
      ).toBe(false);
    });

    it("accepts the canonical wake correlation model", () => {
      expect(
        observabilityWakeCorrelationSchema.safeParse({
          modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
          selector: {
            kind: "dispatch",
            spaceId: "space-1",
            dispatchId: "dispatch-1",
          },
          spaceId: "space-1",
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: AGENT_PROFILE_ID,
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          latestAttemptId: "attempt-1",
          claimLeaseId: null,
          bindingId: "binding-1",
          openMeldServiceRuntimeId: "runtime-1",
          agentControllerRef: "builtin:codex",
          resultRef: "result-1",
          publishedSignalId: "sig-reply-1",
          replySignalId: "sig-reply-1",
          cloudflare: {
            cfRayId: "cf-ray-1",
            requestId: "request-1",
            traceId: "trace-1",
          },
        }).success
      ).toBe(true);
    });

    it("projects canonical wake correlation from existing fact sources", () => {
      const correlation = projectObservabilityWakeCorrelation({
        selector: {
          kind: "dispatch",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
        },
        facts: {
          dispatch: {
            dispatchId: "dispatch-1",
            latestAttemptId: "attempt-1",
            sourceClientMessageId: "client-message-1",
            sourceEventId: "sig-source-1",
            targetProfileId: AGENT_PROFILE_ID,
          },
          coordinatorExecution: {
            bindingId: "binding-1",
            agentControllerRef: "builtin:codex",
            dispatchId: "dispatch-1",
            runtimeCoordinatorExecutionId: "rce-dispatch-1",
            openMeldServiceRuntimeId: "runtime-1",
            sourceClientMessageId: "client-message-1",
            targetProfileId: AGENT_PROFILE_ID,
          },
          latestAttempt: {
            attemptId: "attempt-1",
            dispatchId: "dispatch-1",
          },
          replySignal: {
            signalId: "sig-reply-1",
          },
          result: {
            dispatchId: "dispatch-1",
            publishedSignalId: "sig-reply-1",
            resultRef: "result-1",
          },
        },
        cloudflare: {
          cfRayId: "cf-ray-1",
          requestId: "request-1",
          traceId: "trace-1",
        },
      });

      expect(correlation).toEqual({
        modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
        selector: {
          kind: "dispatch",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
        },
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        latestAttemptId: "attempt-1",
        claimLeaseId: null,
        bindingId: "binding-1",
        openMeldServiceRuntimeId: "runtime-1",
        agentControllerRef: "builtin:codex",
        resultRef: "result-1",
        publishedSignalId: "sig-reply-1",
        replySignalId: "sig-reply-1",
        cloudflare: {
          cfRayId: "cf-ray-1",
          requestId: "request-1",
          traceId: "trace-1",
        },
      });
    });

    it("projects a no-match dispatch correlation from the selector", () => {
      const correlation = projectObservabilityWakeCorrelation({
        selector: {
          kind: "dispatch",
          spaceId: "space-1",
          dispatchId: "dispatch-missing",
        },
      });

      expect(correlation).toMatchObject({
        modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
        spaceId: "space-1",
        dispatchId: "dispatch-missing",
      });
      expect(correlation.clientMessageId).toBeNull();
      expect(correlation.claimLeaseId).toBeNull();
      expect(correlation.runtimeCoordinatorExecutionId).toBeNull();
    });

    it("rejects projected wake correlations whose facts contradict the selector", () => {
      expect(() =>
        projectObservabilityWakeCorrelation({
          selector: {
            kind: "client_message",
            spaceId: "space-1",
            clientMessageId: "client-message-1",
            targetProfileId: AGENT_PROFILE_ID,
          },
          facts: {
            dispatch: {
              dispatchId: "dispatch-1",
              sourceClientMessageId: "client-message-different",
              sourceEventId: "sig-source-1",
              targetProfileId: AGENT_PROFILE_ID,
            },
          },
        })
      ).toThrow("invalid observability wake correlation evidence");
    });

    it("rejects projected wake correlations whose facts contain invalid identifiers", () => {
      expect(() =>
        projectObservabilityWakeCorrelation({
          selector: {
            kind: "dispatch",
            spaceId: "space-1",
            dispatchId: "dispatch-1",
          },
          facts: {
            dispatch: {
              dispatchId: 123,
            },
          },
        })
      ).toThrow("invalid observability wake correlation evidence");
    });

    it("rejects projected wake correlations whose lower-priority facts contain invalid identifiers", () => {
      expect(() =>
        projectObservabilityWakeCorrelation({
          selector: {
            kind: "dispatch",
            spaceId: "space-1",
            dispatchId: "dispatch-1",
          },
          facts: {
            dispatch: {
              dispatchId: "dispatch-1",
            },
            latestAttempt: {
              attemptId: "attempt-1",
              dispatchId: 123,
            },
          },
        })
      ).toThrow("invalid observability wake correlation evidence");
    });

    it("rejects projected wake correlations whose facts contradict each other", () => {
      expect(() =>
        projectObservabilityWakeCorrelation({
          selector: {
            kind: "dispatch",
            spaceId: "space-1",
            dispatchId: "dispatch-1",
          },
          facts: {
            dispatch: {
              dispatchId: "dispatch-1",
              sourceClientMessageId: "client-message-1",
              sourceEventId: "sig-source-1",
              targetProfileId: AGENT_PROFILE_ID,
            },
            result: {
              dispatchId: "dispatch-other",
              resultRef: "result-1",
            },
          },
        })
      ).toThrow("invalid observability wake correlation evidence");
    });

    it("rejects wake correlations whose selector contradicts top-level evidence", () => {
      const canonicalCorrelation = {
        modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
        selector: {
          kind: "client_message",
          spaceId: "space-1",
          clientMessageId: "client-message-1",
          targetProfileId: AGENT_PROFILE_ID,
        },
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        latestAttemptId: "attempt-1",
        claimLeaseId: null,
        bindingId: "binding-1",
        openMeldServiceRuntimeId: "runtime-1",
        agentControllerRef: "builtin:codex",
        resultRef: "result-1",
        publishedSignalId: "sig-reply-1",
        replySignalId: "sig-reply-1",
        cloudflare: {
          cfRayId: null,
          requestId: null,
          traceId: null,
        },
      };

      expect(
        observabilityWakeCorrelationSchema.safeParse({
          ...canonicalCorrelation,
          targetProfileId: "agt-different",
        }).success
      ).toBe(false);

      expect(
        observabilityWakeCorrelationSchema.safeParse({
          ...canonicalCorrelation,
          selector: {
            kind: "dispatch",
            spaceId: "space-1",
            dispatchId: "dispatch-other",
          },
        }).success
      ).toBe(false);
    });
  });

  describe("spaceDiagnosticReport schemas", () => {
    it("accepts sanitized diagnostic report requests", () => {
      expect(
        createSpaceDiagnosticReportBodySchema.safeParse({
          reportedSignalId: "sig-reply-1",
          problemType: "reply_problem",
        }).success
      ).toBe(true);

      expect(
        createSpaceDiagnosticReportBodySchema.safeParse({
          reportedSignalId: "sig-reply-1",
          problemType: "reply_problem",
          text: "full message text must not be part of this contract",
        }).success
      ).toBe(false);
    });

    it("requires exact report responses to carry one wake pointer", () => {
      const parsed = createSpaceDiagnosticReportResponseSchema.safeParse({
        diagnosticReportId: "diag_123",
        spaceId: "space-1",
        reportedSignalId: "sig-reply-1",
        replyToSignalId: "sig-source-1",
        threadId: null,
        problemType: "reply_problem",
        reporterProfileId: HUMAN_PROFILE_ID,
        createdAtMs: 1_805_000_000_000,
        wakePointers: [
          {
            spaceId: "space-1",
            clientMessageId: "client-message-1",
            sourceSignalId: "sig-source-1",
            targetProfileId: AGENT_PROFILE_ID,
          },
        ],
        wakePointerDerivation: {
          status: "exact",
          reasonCodes: ["diagnostic_report.reply_target_exact"],
        },
      });

      expect(parsed.success).toBe(true);
    });

    it("accepts terminal failure diagnostic report reason codes", () => {
      expect(
        createSpaceDiagnosticReportResponseSchema.safeParse({
          diagnosticReportId: "diag_terminal_exact",
          spaceId: "space-1",
          reportedSignalId: "sig-terminal-failure-1",
          replyToSignalId: "sig-source-1",
          threadId: null,
          problemType: "reply_problem",
          reporterProfileId: HUMAN_PROFILE_ID,
          createdAtMs: 1_805_000_000_000,
          wakePointers: [
            {
              spaceId: "space-1",
              clientMessageId: "client-message-1",
              sourceSignalId: "sig-source-1",
              targetProfileId: AGENT_PROFILE_ID,
            },
          ],
          wakePointerDerivation: {
            status: "exact",
            reasonCodes: ["diagnostic_report.terminal_failure_target_exact"],
          },
        }).success
      ).toBe(true);

      expect(
        createSpaceDiagnosticReportResponseSchema.safeParse({
          diagnosticReportId: "diag_terminal_missing_source",
          spaceId: "space-1",
          reportedSignalId: "sig-terminal-failure-1",
          replyToSignalId: "sig-source-1",
          threadId: null,
          problemType: "reply_problem",
          reporterProfileId: HUMAN_PROFILE_ID,
          createdAtMs: 1_805_000_000_000,
          wakePointers: [],
          wakePointerDerivation: {
            status: "unavailable",
            reasonCodes: [
              "diagnostic_report.terminal_failure_source_signal_not_found",
            ],
          },
        }).success
      ).toBe(true);
    });

    it("accepts diagnostic wake pointers without a client message ID", () => {
      const parsed = createSpaceDiagnosticReportResponseSchema.safeParse({
        diagnosticReportId: "diag_agent_authored_exact",
        spaceId: "space-1",
        reportedSignalId: "sig-agent-reply-1",
        replyToSignalId: "sig-agent-source-1",
        threadId: null,
        problemType: "reply_problem",
        reporterProfileId: HUMAN_PROFILE_ID,
        createdAtMs: 1_805_000_000_000,
        wakePointers: [
          {
            spaceId: "space-1",
            clientMessageId: null,
            sourceSignalId: "sig-agent-source-1",
            targetProfileId: AGENT_PROFILE_ID,
          },
        ],
        wakePointerDerivation: {
          status: "exact",
          reasonCodes: ["diagnostic_report.reply_target_exact"],
        },
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects mismatched diagnostic pointer states", () => {
      expect(
        createSpaceDiagnosticReportResponseSchema.safeParse({
          diagnosticReportId: "diag_123",
          spaceId: "space-1",
          reportedSignalId: "sig-reply-1",
          replyToSignalId: null,
          threadId: null,
          problemType: "message_problem",
          reporterProfileId: HUMAN_PROFILE_ID,
          createdAtMs: 1_805_000_000_000,
          wakePointers: [],
          wakePointerDerivation: {
            status: "exact",
            reasonCodes: ["diagnostic_report.reply_target_exact"],
          },
        }).success
      ).toBe(false);
    });
  });

  describe("cloudflare runtime observability schemas", () => {
    it("projects canonical Cloudflare runtime evidence events", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "gateway.openmeld.space.signal_posted",
        workerName: "openmeld-gateway",
        workerEnvironment: "prod",
        runtimeKind: "rpc",
        status: "succeeded",
        operation: "postSignal",
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        statusCode: 200,
        durationMs: 12.5,
        activationTargetCount: 2,
        inputBytes: 4096,
        toolCount: 42,
        cfRayId: "cf-ray-1",
        requestId: "request-1",
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
      });

      expect(event).toEqual({
        modelVersion: OBSERVABILITY_CLOUDFLARE_RUNTIME_EVENT_MODEL_VERSION,
        correlationModelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
        event: "gateway.openmeld.space.signal_posted",
        workerName: "openmeld-gateway",
        workerEnvironment: "prod",
        runtime: "cloudflare_workers",
        runtimeKind: "rpc",
        status: "succeeded",
        operation: "postSignal",
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        statusCode: 200,
        durationMs: 12.5,
        messageCount: null,
        activationTargetCount: 2,
        inputBytes: 4096,
        toolCount: 42,
        reasonCode: null,
        errorName: null,
        cfRayId: "cf-ray-1",
        requestId: "request-1",
        traceId: null,
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        latestAttemptId: null,
        claimLeaseId: null,
        bindingId: null,
        openMeldServiceRuntimeId: null,
        agentControllerRef: null,
        resultRef: null,
        publishedSignalId: null,
        replySignalId: null,
      });

      expect(
        observabilityCloudflareRuntimeEventSchema.safeParse(event).success
      ).toBe(true);
    });

    it("accepts Remote Agent runtime evidence in the shared worker model", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "remote_agent.openmeld.turn",
        workerName: "openmeld-remote-agent",
        workerEnvironment: "prod",
        runtimeKind: "durable_object",
        status: "succeeded",
        reasonCode: "remote_agent.turn.completed",
        durationMs: 42,
        requestId: "flue_submission_123",
        spaceId: "space-1",
      });

      expect(event.workerName).toBe("openmeld-remote-agent");
      expect(
        projectObservabilityCloudflareAnalyticsDataPoint(event).blobs[0]
      ).toBe("remote_agent.openmeld.turn");
    });

    it("projects Workflow runtime evidence by Routine Run id", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        dispatchId: "routine_run_123",
        event: "core.openmeld.routine_workflow.instance_created",
        operation: "routine_workflow.instance_created",
        reasonCode: "workflow.created",
        runtimeKind: "workflow",
        status: "succeeded",
        workerEnvironment: "prod",
        workerName: "openmeld-core",
      });

      expect(event.runtimeKind).toBe("workflow");
      expect(
        projectObservabilityCloudflareAnalyticsDataPoint(event).indexes
      ).toEqual(["routine_run_123"]);
    });

    it("projects Cloudflare Analytics Engine datapoints with stable field order", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_message_started",
        workerName: "openmeld-core",
        workerEnvironment: "prod",
        runtimeKind: "queue",
        status: "started",
        operation: "openMeldDaemon-dispatch",
        durationMs: 0,
        messageCount: 1,
        inputBytes: 4096,
        toolCount: 42,
        requestId: "request-1",
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        latestAttemptId: "attempt-1",
        bindingId: "binding-1",
        openMeldServiceRuntimeId: "runtime-1",
        agentControllerRef: "builtin:codex",
        publishedSignalId: "sig-published-1",
      });

      const point = projectObservabilityCloudflareAnalyticsDataPoint(event);

      expect(OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS).toEqual([
        "event",
        "workerName",
        "runtimeKind",
        "status",
        "reasonCode",
        "spaceId",
        "clientMessageId",
        "sourceSignalId",
        "targetProfileId",
        "dispatchId",
        "runtimeCoordinatorExecutionId",
        "latestAttemptId",
        "claimLeaseId",
        "bindingId",
        "openMeldServiceRuntimeId",
        "agentControllerRef",
        "resultRef",
        "publishedSignalId",
        "replySignalId",
        "requestId",
      ]);
      expect(OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES).toEqual([
        "count",
        "durationMs",
        "statusCode",
        "messageCount",
        "activationTargetCount",
        "inputBytes",
        "toolCount",
      ]);
      expect(point.blobs).toEqual([
        "core.openmeld.dispatch.queue_message_started",
        "openmeld-core",
        "queue",
        "started",
        "",
        "space-1",
        "client-message-1",
        "sig-source-1",
        AGENT_PROFILE_ID,
        "dispatch-1",
        "rce-dispatch-1",
        "attempt-1",
        "",
        "binding-1",
        "runtime-1",
        "builtin:codex",
        "",
        "sig-published-1",
        "",
        "request-1",
      ]);
      expect(point.doubles).toEqual([1, 0, 0, 1, 0, 4096, 42]);
      expect(point.indexes).toEqual(["client-message-1"]);
      expect(point.blobs).toHaveLength(20);
      expect(
        observabilityCloudflareAnalyticsDataPointSchema.safeParse(point).success
      ).toBe(true);
    });

    it("projects Server-Timing segment evidence through existing Analytics Engine columns", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_server_timing",
        workerName: "openmeld-core",
        workerEnvironment: "prod",
        runtimeKind: "queue",
        status: "succeeded",
        operation: "openMeldDaemon-dispatch",
        reasonCode: "openmeld_dispatch_activity",
        durationMs: 24.5,
        messageCount: 1,
        spaceId: "space-1",
        clientMessageId: "client-message-1",
        sourceSignalId: "sig-source-1",
        targetProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
      });

      const point = projectObservabilityCloudflareAnalyticsDataPoint(event);

      expect(point.blobs[0]).toBe("core.openmeld.dispatch.queue_server_timing");
      expect(point.blobs[4]).toBe("openmeld_dispatch_activity");
      expect(point.doubles[1]).toBe(24.5);
    });

    it("indexes Cloudflare Analytics Engine datapoints by Wake selector before broad Space scope", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_message_started",
        workerName: "openmeld-core",
        runtimeKind: "queue",
        status: "started",
        requestId: "request-1",
        spaceId: "space-1",
        sourceSignalId: "sig-source-1",
        dispatchId: "dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
      });

      const point = projectObservabilityCloudflareAnalyticsDataPoint(event);

      expect(point.indexes).toEqual(["rce-dispatch-1"]);
    });

    it("keeps the Cloudflare Analytics Engine index within platform limits", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_message_started",
        workerName: "openmeld-core",
        runtimeKind: "queue",
        status: "started",
        spaceId: `space-${"x".repeat(160)}`,
      });

      const point = projectObservabilityCloudflareAnalyticsDataPoint(event);

      expect(point.indexes).toHaveLength(1);
      const analyticsIndex = point.indexes[0];
      if (!analyticsIndex) {
        throw new Error("Expected one Analytics Engine index.");
      }
      expect(analyticsIndex.length).toBeLessThanOrEqual(96);
      expect(analyticsIndex).toMatch(
        CLOUDFLARE_ANALYTICS_LONG_SPACE_INDEX_PATTERN
      );
    });

    it("keeps successful HTTP runtime evidence out of custom console logs", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "gateway.openmeld.http_request",
        workerName: "openmeld-gateway",
        workerEnvironment: "prod",
        runtimeKind: "http",
        status: "succeeded",
        route: "/v1/profiles",
        method: "GET",
        statusCode: 200,
        durationMs: 12,
        requestId: "request-1",
      });

      expect(shouldLogObservabilityCloudflareRuntimeEvent(event)).toBe(false);
    });

    it("logs failed HTTP runtime evidence as compact structured objects", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.http_request",
        workerName: "openmeld-core",
        workerEnvironment: "prod",
        runtimeKind: "http",
        status: "failed",
        route: "/v1/spaces/space-1/signals",
        method: "POST",
        statusCode: 500,
        durationMs: 32,
        reasonCode: "http_500",
        errorName: "Error",
        requestId: "request-1",
        spaceId: "space-1",
      });

      expect(shouldLogObservabilityCloudflareRuntimeEvent(event)).toBe(true);
      expect(projectObservabilityCloudflareRuntimeConsoleEvent(event)).toEqual({
        event: "core.openmeld.http_request",
        workerName: "openmeld-core",
        runtimeKind: "http",
        status: "failed",
        workerEnvironment: "prod",
        route: "/v1/spaces/space-1/signals",
        method: "POST",
        statusCode: 500,
        durationMs: 32,
        reasonCode: "http_500",
        errorName: "Error",
        requestId: "request-1",
        spaceId: "space-1",
      });
    });

    it("keeps started runtime evidence out of custom console logs", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_message_started",
        workerName: "openmeld-core",
        workerEnvironment: "prod",
        runtimeKind: "queue",
        status: "started",
        operation: "openMeldDaemon-dispatch",
        messageCount: 1,
        spaceId: "space-1",
        dispatchId: "dispatch-1",
      });

      expect(shouldLogObservabilityCloudflareRuntimeEvent(event)).toBe(false);
    });

    it("keeps completed non-HTTP runtime evidence visible in custom console logs", () => {
      const event = projectObservabilityCloudflareRuntimeEvent({
        event: "core.openmeld.dispatch.queue_batch_succeeded",
        workerName: "openmeld-core",
        workerEnvironment: "prod",
        runtimeKind: "queue",
        status: "succeeded",
        operation: "openMeldDaemon-dispatch",
        messageCount: 1,
        spaceId: "space-1",
        dispatchId: "dispatch-1",
      });

      expect(shouldLogObservabilityCloudflareRuntimeEvent(event)).toBe(true);
    });

    it("rejects invalid Cloudflare runtime evidence events", () => {
      expect(() =>
        projectObservabilityCloudflareRuntimeEvent({
          event: "gateway.openmeld.space.signal_posted",
          workerName: "openmeld-gateway",
          runtimeKind: "rpc",
          status: "succeeded",
          clientMessageId: "",
        })
      ).toThrow("invalid observability cloudflare runtime event evidence");
    });
  });

  describe("spaceDispatchTrace schemas", () => {
    const VALID_TRACE_RESPONSE = {
      correlation: {
        modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
        selector: {
          kind: "dispatch",
          spaceId: "space-demo",
          dispatchId: "dispatch-demo",
        },
        spaceId: "space-demo",
        clientMessageId: "client-message-demo",
        sourceSignalId: "evt-1",
        targetProfileId: "agt-demo",
        dispatchId: "dispatch-demo",
        runtimeCoordinatorExecutionId: null,
        latestAttemptId: "attempt-2",
        claimLeaseId: null,
        bindingId: "binding-demo",
        openMeldServiceRuntimeId: "runtime-demo",
        agentControllerRef: "builtin:codex",
        resultRef: "result-demo",
        publishedSignalId: "sig-1",
        replySignalId: "sig-1",
        cloudflare: {
          cfRayId: null,
          requestId: null,
          traceId: null,
        },
      },
      query: {
        spaceId: "space-demo",
        dispatchId: "dispatch-demo",
      },
      trace: {
        dispatch: {
          factSource: "dispatch_ledger",
          dispatchId: "dispatch-demo",
          idempotencyKey: "idem-1",
          sourceEventId: "evt-1",
          sourceClientMessageId: "client-message-demo",
          owner: {
            id: "owner-demo",
            kind: "owner_account",
          },
          targetProfileId: "agt-demo",
          status: "dispatching",
          firstSeenAt: "2026-03-09T00:00:00.000Z",
          lastAttemptAt: "2026-03-09T00:00:01.000Z",
          attemptCount: 2,
          latestAttemptId: "attempt-2",
        },
        latestAttempt: {
          factSource: "dispatch_attempt",
          attemptId: "attempt-2",
          dispatchId: "dispatch-demo",
          idempotencyKey: "idem-1",
          attemptNo: 2,
          status: "waiting_result",
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 3,
          createdAt: "2026-03-09T00:00:01.000Z",
          startedAt: "2026-03-09T00:00:02.000Z",
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
        },
        executionIdentity: {
          factSource: "dispatch_attempt_execution_identity",
          authority: "authoritative",
          core: {
            modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
            spaceId: "space-demo",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-demo",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-demo",
            },
            bindingId: "binding-demo",
            agentControllerRef: "builtin:codex",
          },
        },
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorCreationDiagnostics: [],
        runtimeCoordinatorEvents: [],
        runtimeCoordinatorHeadLifecycle: null,
        claimLease: null,
        result: {
          factSource: "dispatch_result",
          resultRef: "result-demo",
          dispatchId: "dispatch-demo",
          resultKind: "final_text",
          publicOutcome: "succeeded",
          publishedSignalId: "sig-1",
          statusType: null,
          createdAt: "2026-03-09T00:00:04.000Z",
        },
        resultInbox: {
          factSource: "dispatch_result_inbox",
          resultKey: "dispatch-demo::attempt-2",
          dispatchId: "dispatch-demo",
          attemptId: "attempt-2",
          taskId: "task-demo",
          targetProfileId: "agt-demo",
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 3,
          submittedConnectionGeneration: 2,
          publishState: "reply_published",
          publishedSignalId: "sig-1",
          publicationErrorCode: null,
          acceptedAt: "2026-03-09T00:00:03.500Z",
          updatedAt: "2026-03-09T00:00:04.000Z",
        },
        recentOpsDecisions: [
          {
            factSource: "ops_decision",
            id: "ops-1",
            decisionCode: "dispatch.reclaimed",
            decidedBy: "dispatch-queue",
            source: "core",
            decidedAt: "2026-03-09T00:00:03.000Z",
            correlationId: "dispatch-demo",
            expectedRecoveryCriteria: null,
          },
        ],
        replySignal: {
          factSource: "space_signal_by_published_signal_id",
          signalId: "sig-1",
          profileId: "agt-demo",
          profileKind: "agent",
          profileName: "Demo Bot",
          text: "Done",
          createdAt: "2026-03-09T00:00:04.000Z",
        },
        streaming: {
          streamingMode: "final",
          previewEmitted: false,
          firstStdoutAt: "2026-03-09T00:00:02.000Z",
          firstOutputAt: "2026-03-09T00:00:04.000Z",
        },
        runtime: {
          processId: 4321,
          processSpawnedAt: "2026-03-09T00:00:02.000Z",
          stdinClosedAt: "2026-03-09T00:00:02.010Z",
          firstStderrAt: null,
          exitObservedAt: null,
          exitCode: null,
          exitSignal: null,
          timeoutTriggeredAt: null,
        },
        execution: {
          phase: "running",
          phaseEnteredAt: "2026-03-09T00:00:02.050Z",
          lastLifecycleAt: "2026-03-09T00:00:03.000Z",
          progressEvidenceState: "active",
          timeoutPolicy: {
            finalizationTimeoutMs: 30_000,
            startTimeoutMs: 30_000,
            taskProgressEvidenceStaleAfterMs: 90_000,
            waitWindowMs: 30_000,
          },
        },
        origin: {
          agentControllerConversationId: "session-demo-1",
          agentControllerRef: "openclaw",
          agentControllerConversationKind: "session",
          resolvedAgentControllerConversationId: "agent:demo:space:demo",
          effectiveRuntimeWorkingDirectory: "/tmp/openmeld-openclaw",
          runtimeWorkspaceFingerprint: "sha256:openmeld-openclaw-workspace",
        },
        prompt: {
          fingerprint: "sha256:prompt-demo",
          length: 512,
          preview:
            "Space Dispatch Brief:\n- Complete this Wake through one dispatch-scoped OpenMeld Space Action CLI command.",
        },
        dispatchExecution: {
          agentControllerConversationResume: {
            status: "continued",
          },
          localRuntimeContext: {
            status: "reused",
            reason: null,
          },
          bootstrap: {
            reason: null,
            status: "applied",
          },
        },
        openClawGatewayVisibility: null,
        openClawBinding: null,
        structuredActionFailure: null,
      },
    } as const;

    it("accepts canonical dispatch trace payload", () => {
      const parsed =
        spaceDispatchTraceResponseSchema.safeParse(VALID_TRACE_RESPONSE);
      expect(parsed.success).toBe(true);
    });

    it("accepts hosted native-delivery identity without workstation execution identity", () => {
      const hostedNativeDelivery = {
        bindingId: "binding-hosted-demo",
        controllerNormalization: {
          bindingUpdatedAt: "2026-03-09T00:00:01.000Z",
          canonicalAgentControllerRef: "hosted:center-agent",
          factSource: "remote_agent_native_delivery_ledger",
          reasonCode: "hosted_runtime_family_controller_canonicalized",
          storedAgentControllerRef: null,
          storedAgentControllerRefStatus: "missing",
        },
        createdAt: "2026-03-09T00:00:01.000Z",
        deliveryId: "delivery-hosted-demo",
        destination: {
          conversationKind: "space",
          organizationId: "org-demo",
          spaceId: "space-demo",
          targetProfileId: "agt-demo",
        },
        dispatchId: "dispatch-demo",
        factSource: "remote_agent_native_delivery_ledger",
        idempotencyKey: "idem-1",
        runtimeFamily: "hosted_center_agent",
        status: "accepted",
        submissionId: "submission-hosted-demo",
        updatedAt: "2026-03-09T00:00:02.000Z",
      } as const;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          agentControllerRef:
            hostedNativeDelivery.controllerNormalization
              .canonicalAgentControllerRef,
          bindingId: hostedNativeDelivery.bindingId,
          openMeldServiceRuntimeId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          executionIdentity: null,
          nativeDelivery: hostedNativeDelivery,
        },
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects hosted native-delivery identity that drifts from the dispatch", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          nativeDelivery: {
            bindingId: "binding-demo",
            controllerNormalization: {
              bindingUpdatedAt: "2026-03-09T00:00:01.000Z",
              canonicalAgentControllerRef: "hosted:center-agent",
              factSource: "remote_agent_native_delivery_ledger",
              reasonCode: "hosted_runtime_family_controller_canonicalized",
              storedAgentControllerRef: null,
              storedAgentControllerRefStatus: "missing",
            },
            createdAt: "2026-03-09T00:00:01.000Z",
            deliveryId: "delivery-hosted-demo",
            destination: {
              conversationKind: "space",
              organizationId: "org-demo",
              spaceId: "space-other",
              targetProfileId: "agt-other",
            },
            dispatchId: "dispatch-other",
            factSource: "remote_agent_native_delivery_ledger",
            idempotencyKey: "idem-1",
            runtimeFamily: "hosted_center_agent",
            status: "accepted",
            submissionId: "submission-hosted-demo",
            updatedAt: "2026-03-09T00:00:02.000Z",
          },
        },
      });

      expect(parsed.success).toBe(false);
    });

    it("accepts path-free Default Project failure context in result inbox trace", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            projectFailureContext: {
              bindingGeneration: "binding-1",
              projectId: "project-1",
            },
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace?.resultInbox)) {
        throw new Error("expected parsed Project failure trace context");
      }
      expect(parsed.data.trace.resultInbox.projectFailureContext).toEqual({
        bindingGeneration: "binding-1",
        projectId: "project-1",
      });

      const withLocalPath = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            projectFailureContext: {
              localPath: "/private/repository",
              projectId: "project-1",
            },
          },
        },
      });
      expect(withLocalPath.success).toBe(false);
    });

    it("accepts a terminal failure final visible message without requiring a text reply signal", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          publishedSignalId: "sig-terminal-failure",
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          latestAttempt: {
            ...VALID_TRACE_RESPONSE.trace.latestAttempt,
            status: "failed_terminal",
            errorCode: "auth.required",
            errorMessage:
              "Your organization has disabled Claude subscription access for Claude Code",
          },
          result: {
            ...VALID_TRACE_RESPONSE.trace.result,
            publicOutcome: "system_notice",
            publishedSignalId: "sig-terminal-failure",
          },
          replySignal: null,
          finalVisibleMessage: {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-terminal-failure",
            signalType: "signal.system_notice",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-demo",
            profileId: "openmeld-system",
            profileKind: "system",
            profileName: "OpenMeld",
            text: "Claude Code subscription access is unavailable for this account.",
            reasonCode: "auth.required",
            noticeType: "terminal_failure",
            statusType: null,
            createdAt: "2026-03-09T00:00:04.000Z",
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "auth.required",
        source: "final_visible_message",
      });
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: true,
        publicationKind: "failure_notice",
        reasonCode: "auth.required",
        signalId: "sig-terminal-failure",
        sourceFact: "final_visible_message",
        status: "visible_failure",
      });
    });

    it("projects a missing final visible message as unresolved instead of delivered", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          replySignal: null,
          finalVisibleMessage: null,
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_unresolved",
        source: "final_visible_outcome",
      });
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "success_reply",
        reasonCode: "final_visible_outcome.publication_unresolved",
        signalId: "sig-1",
        sourceFact: "dispatch_result",
        sourceReasonCode: "reply.not_found",
        status: "publication_unresolved",
      });
    });

    it("accepts a final visible message recovered from the Space final reply claim", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          resultRef: null,
          publishedSignalId: null,
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          result: null,
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            publishState: "result_accepted",
            publishedSignalId: null,
          },
          replySignal: null,
          finalVisibleMessage: {
            factSource: "space_final_reply_claim",
            signalId: "sig-claim-final",
            signalType: "signal.text",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-demo",
            profileId: "agt-demo",
            profileKind: "agent",
            profileName: "Demo Bot",
            text: "Done",
            reasonCode: null,
            noticeType: null,
            statusType: null,
            createdAt: "2026-03-09T00:00:04.000Z",
          },
          finalVisibleMessageLinkage: {
            status: "matched_final_reply_claim",
            reasonCode: "final_visible_message.matched_final_reply_claim",
            sourceFact: "space_final_reply_claim",
            candidateSignalIds: [],
            claimSignalId: "sig-claim-final",
            selectedSignalId: "sig-claim-final",
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: true,
        reasonCode: "reply.delivered",
        signalId: "sig-claim-final",
        sourceFact: "final_visible_message",
        status: "visible_reply",
      });
    });

    it("projects a hosted Center Agent text failure notice as a structured visible failure", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          bindingId: "binding-hosted-demo",
          openMeldServiceRuntimeId: null,
          agentControllerRef: "hosted:center-agent",
          resultRef: null,
          publishedSignalId: null,
          replySignalId: "sig-turn-not-completed",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          dispatch: {
            ...VALID_TRACE_RESPONSE.trace.dispatch,
            status: "failed_terminal",
          },
          latestAttempt: {
            ...VALID_TRACE_RESPONSE.trace.latestAttempt,
            status: "failed_terminal",
            errorCode: "remote_agent.turn_not_completed",
            errorMessage: null,
            finishedAt: "2026-03-09T00:00:04.000Z",
          },
          executionIdentity: null,
          nativeDelivery: {
            bindingId: "binding-hosted-demo",
            controllerNormalization: {
              bindingUpdatedAt: "2026-03-09T00:00:01.000Z",
              canonicalAgentControllerRef: "hosted:center-agent",
              factSource: "remote_agent_native_delivery_ledger",
              reasonCode: "hosted_runtime_family_controller_canonicalized",
              storedAgentControllerRef: null,
              storedAgentControllerRefStatus: "missing",
            },
            createdAt: "2026-03-09T00:00:01.000Z",
            deliveryId: "delivery-hosted-demo",
            destination: {
              conversationKind: "space",
              organizationId: "org-demo",
              spaceId: "space-demo",
              targetProfileId: "agt-demo",
            },
            dispatchId: "dispatch-demo",
            factSource: "remote_agent_native_delivery_ledger",
            idempotencyKey: "idem-1",
            runtimeFamily: "hosted_center_agent",
            status: "failed",
            submissionId: "submission-hosted-demo",
            updatedAt: "2026-03-09T00:00:04.000Z",
          },
          result: null,
          resultInbox: null,
          replySignal: {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-turn-not-completed",
            profileId: "agt-demo",
            profileKind: "agent",
            profileName: "Demo Bot",
            text: "OpenMeld ran into a problem, so Center Agent couldn't finish your request.",
            createdAt: "2026-03-09T00:00:04.000Z",
          },
          finalVisibleMessage: {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-turn-not-completed",
            signalType: "signal.text",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-demo",
            profileId: "agt-demo",
            profileKind: "agent",
            profileName: "Demo Bot",
            text: "OpenMeld ran into a problem, so Center Agent couldn't finish your request.",
            reasonCode: "remote_agent.turn_not_completed",
            noticeType: null,
            statusType: null,
            createdAt: "2026-03-09T00:00:04.000Z",
          },
          finalVisibleMessageLinkage: {
            status: "matched_published_signal",
            reasonCode: "final_visible_message.matched_published_signal",
            sourceFact: "published_signal_candidate",
            candidateSignalIds: ["sig-turn-not-completed"],
            claimSignalId: null,
            selectedSignalId: "sig-turn-not-completed",
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toEqual({
        delivered: true,
        publicationErrorCode: null,
        publicationKind: "failure_notice",
        reasonCode: "remote_agent.turn_not_completed",
        signalId: "sig-turn-not-completed",
        sourceFact: "final_visible_message",
        sourceReasonCode: "remote_agent.turn_not_completed",
        sourceStatus: "signal.text",
        status: "visible_failure",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "remote_agent.turn_not_completed",
        source: "final_visible_message",
      });
    });

    it("surfaces linkage missing as machine-readable root cause", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          replySignal: null,
          finalVisibleMessage: null,
          finalVisibleMessageLinkage: {
            status: "linkage_missing",
            reasonCode: "final_visible_message.published_signal_missing",
            sourceFact: "published_signal_candidate",
            candidateSignalIds: ["sig-1"],
            claimSignalId: null,
            selectedSignalId: null,
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_message.published_signal_missing",
        source: "final_visible_message",
      });
    });

    it("keeps a real final reply visible even when stale publication failure evidence exists", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          finalVisibleMessage: {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-1",
            signalType: "signal.text",
            dispatchId: "dispatch-demo",
            targetProfileId: "agt-demo",
            profileId: "agt-demo",
            profileKind: "agent",
            profileName: "Demo Bot",
            text: "Done",
            reasonCode: null,
            noticeType: null,
            statusType: null,
            createdAt: "2026-03-09T00:00:04.000Z",
          },
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            publishState: "reply_publication_failed",
            publicationErrorCode: "space.signal.persist_failed",
            publishedSignalId: null,
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: true,
        reasonCode: "reply.delivered",
        signalId: "sig-1",
        status: "visible_reply",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "reply.delivered",
        source: "final_visible_message",
      });
    });

    it("projects result publication failure as a not-delivered retrying final outcome", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          replySignal: null,
          finalVisibleMessage: null,
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            publishState: "reply_publication_failed",
            publicationErrorCode: "space.signal.persist_failed",
            publishedSignalId: null,
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "success_reply",
        reasonCode: "final_visible_outcome.publication_retrying",
        sourceFact: "result_inbox",
        sourceReasonCode: "space.signal.persist_failed",
        status: "publication_retrying",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_retrying",
        source: "final_visible_outcome",
      });
    });

    it("uses structured publication evidence instead of words in a retry reason", () => {
      const buildRetryableExecution = (reasonCode: string) => ({
        bindingId: "binding-demo",
        agentControllerRef: "builtin:codex",
        createdAtMs: 1_762_473_599_000,
        dispatchId: "dispatch-demo",
        factSource: "runtime_coordinator_projection" as const,
        legacyPointers: {
          attemptId: "attempt-2",
          claimLeaseId: null,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 3,
        },
        modelVersion: "openmeld.runtime_coordinator.execution.v1" as const,
        runtimeCoordinatorExecutionId: "rce-demo",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority" as const,
          value: "runtime-demo",
        },
        sourceClientMessageId: "client-message-demo",
        spaceId: "space-demo",
        status: "failed_retryable" as const,
        targetProfileId: "agt-demo",
        terminalOutcome: {
          kind: "failed_retryable" as const,
          observedAtMs: 1_762_473_604_000,
          reasonCode,
        },
        updatedAtMs: 1_762_473_604_000,
      });
      const buildResponse = (
        reasonCode: string,
        runtimeCoordinatorEvents: unknown[]
      ) => ({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          runtimeCoordinatorExecutionId: "rce-demo",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          finalVisibleMessage: null,
          replySignal: null,
          result: null,
          resultInbox: null,
          runtimeCoordinatorEvents,
          runtimeCoordinatorExecution: buildRetryableExecution(reasonCode),
        },
      });

      const lexicalCollision = spaceDispatchTraceResponseSchema.safeParse(
        buildResponse("provider.publication_catalog_unavailable", [])
      );
      expect(lexicalCollision.success).toBe(true);
      if (!(lexicalCollision.success && lexicalCollision.data.trace)) {
        throw new Error("expected lexical collision trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(
          lexicalCollision.data.trace
        )
      ).toMatchObject({ status: "not_applicable" });
      expect(
        projectSpaceDispatchTraceRootCause(lexicalCollision.data.trace)
      ).toEqual({
        reasonCode: "provider.publication_catalog_unavailable",
        source: "runtime_coordinator",
      });

      const structuredPublicationFailure =
        spaceDispatchTraceResponseSchema.safeParse(
          buildResponse("transport.temporarily_unavailable", [
            {
              eventId: "event-publication-failed",
              eventType: "reply_publication_failed",
              factSource: "runtime_coordinator_projection",
              idempotencyKey: "publication:dispatch-demo:attempt-2:failed",
              observedAtMs: 1_762_473_604_000,
              payloadJson: JSON.stringify({
                publishState: "reply_publication_failed",
              }),
              reasonCode: "transport.temporarily_unavailable",
              runtimeCoordinatorExecutionId: "rce-demo",
              statusAfter: "failed_retryable",
            },
          ])
        );
      expect(structuredPublicationFailure.success).toBe(true);
      if (
        !(
          structuredPublicationFailure.success &&
          structuredPublicationFailure.data.trace
        )
      ) {
        throw new Error("expected structured publication failure trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(
          structuredPublicationFailure.data.trace
        )
      ).toMatchObject({
        publicationErrorCode: "transport.temporarily_unavailable",
        sourceFact: "runtime_coordinator_execution",
        status: "publication_retrying",
      });
    });

    it("projects the final publication state matrix consistently for success replies and failure notices", () => {
      const headFailureLifecycle = {
        createdAt: "2026-03-09T00:00:01.100Z",
        duplicateDispatchCount: 0,
        executionLinkedAt: null,
        factSource: "runtime_coordinator_head_lifecycle",
        modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
        noExecutionDecision: {
          decidedAt: "2026-03-09T00:00:01.200Z",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.missing",
          source: "dispatch_preflight",
          userRecoveryAction: "set_up_agent_binding",
        },
        ownerUserId: "owner-demo",
        primaryDispatchId: "dispatch-demo",
        publicationIntent: {
          intentId: "twl_space-demo_evt-1_agt-demo::no-execution-failure",
          kind: "no_execution_failure",
          publicationCategory: "binding_required",
          readyAt: "2026-03-09T00:00:01.300Z",
          reasonCode: "agent_profile_binding.missing",
          status: "ready_for_phase_6",
          userRecoveryAction: "set_up_agent_binding",
        },
        readStatus: "found",
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleIdentity: {
          clientMessageId: "client-message-demo",
          dispatchId: "dispatch-demo",
          modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
          sourceSignalId: "evt-1",
          spaceId: "space-demo",
          targetProfileId: "agt-demo",
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
        },
        targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
        updatedAt: "2026-03-09T00:00:01.300Z",
        waitingBoundary: null,
      } as const;
      const publicationUnresolvedExecution = {
        bindingId: "binding-demo",
        agentControllerRef: "builtin:codex",
        createdAtMs: 1_762_473_599_000,
        dispatchId: "dispatch-demo",
        factSource: "runtime_coordinator_projection",
        legacyPointers: {
          attemptId: "attempt-2",
          claimLeaseId: null,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 3,
        },
        modelVersion: "openmeld.runtime_coordinator.execution.v1",
        runtimeCoordinatorExecutionId: "rce-demo",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-demo",
        },
        sourceClientMessageId: "client-message-demo",
        spaceId: "space-demo",
        status: "failed_terminal",
        targetProfileId: "agt-demo",
        terminalOutcome: {
          kind: "failed_terminal",
          observedAtMs: 1_762_473_601_000,
          reasonCode: "runtime_coordinator.publication_unresolved",
        },
        updatedAtMs: 1_762_473_601_000,
      } as const;
      const finalPublicationStateMatrix = [
        {
          name: "success reply published",
          expected: {
            delivered: true,
            publicationKind: "success_reply",
            status: "visible_reply",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            finalVisibleMessage: {
              factSource: "space_signal_by_published_signal_id",
              signalId: "sig-1",
              signalType: "signal.text",
              dispatchId: "dispatch-demo",
              targetProfileId: "agt-demo",
              profileId: "agt-demo",
              profileKind: "agent",
              profileName: "Demo Bot",
              text: "Done",
              reasonCode: null,
              noticeType: null,
              statusType: null,
              createdAt: "2026-03-09T00:00:04.000Z",
            },
          },
        },
        {
          name: "failure notice published",
          expected: {
            delivered: true,
            publicationKind: "failure_notice",
            status: "visible_failure",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            replySignal: null,
            finalVisibleMessage: {
              factSource: "space_signal_by_published_signal_id",
              signalId: "sig-1",
              signalType: "signal.system_notice",
              dispatchId: "dispatch-demo",
              targetProfileId: "agt-demo",
              profileId: "openmeld-system",
              profileKind: "system",
              profileName: "OpenMeld",
              text: "OpenMeld could not wake Demo Bot.",
              reasonCode: "agent_profile_binding.missing",
              noticeType: "terminal_failure",
              statusType: null,
              createdAt: "2026-03-09T00:00:04.000Z",
            },
          },
        },
        {
          name: "success reply retrying",
          expected: {
            delivered: false,
            publicationKind: "success_reply",
            sourceFact: "result_inbox",
            status: "publication_retrying",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            finalVisibleMessage: null,
            replySignal: null,
            resultInbox: {
              ...VALID_TRACE_RESPONSE.trace.resultInbox,
              publicationErrorCode: "space.signal.persist_failed",
              publishedSignalId: null,
              publishState: "reply_publication_failed",
            },
          },
        },
        {
          name: "failure notice retrying",
          expected: {
            delivered: false,
            publicationKind: "failure_notice",
            sourceFact: "runtime_coordinator_head_lifecycle",
            status: "publication_retrying",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            finalVisibleMessage: null,
            replySignal: null,
            runtimeCoordinatorHeadLifecycle: {
              ...headFailureLifecycle,
              publicationOutcome: {
                failurePublicationCommandId: "fpc-retrying",
                finalMessageKind: null,
                observedAt: "2026-03-09T00:00:02.000Z",
                publicationErrorCode:
                  "runtime_coordinator.failure_publication_unavailable",
                publishedSignalId: null,
                status: "failure_publication_failed",
              },
            },
          },
        },
        {
          name: "success reply unresolved",
          expected: {
            delivered: false,
            publicationKind: "success_reply",
            sourceFact: "runtime_coordinator_event",
            status: "publication_unresolved",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            finalVisibleMessage: null,
            replySignal: null,
            runtimeCoordinatorExecution: publicationUnresolvedExecution,
            runtimeCoordinatorEvents: [
              {
                eventId: "event-success-publication-unresolved",
                eventType: "runtime_coordinator_decision_recorded",
                factSource: "runtime_coordinator_projection",
                idempotencyKey: "publication:blocker:success",
                observedAtMs: 1_762_473_601_000,
                payloadJson: JSON.stringify({
                  publicationKind: "success_reply",
                  reasonCode: "runtime_coordinator.publication_retry_exhausted",
                  status: "unresolved_publication_failure",
                  targetProfileId: "agt-demo",
                }),
                reasonCode: "runtime_coordinator.publication_unresolved",
                runtimeCoordinatorExecutionId: "rce-demo",
                statusAfter: "failed_terminal",
              },
            ],
          },
        },
        {
          name: "failure notice unresolved",
          expected: {
            delivered: false,
            publicationKind: "failure_notice",
            sourceFact: "runtime_coordinator_event",
            status: "publication_unresolved",
          },
          trace: {
            ...VALID_TRACE_RESPONSE.trace,
            finalVisibleMessage: null,
            replySignal: null,
            runtimeCoordinatorExecution: publicationUnresolvedExecution,
            runtimeCoordinatorEvents: [
              {
                eventId: "event-failure-publication-unresolved",
                eventType: "runtime_coordinator_decision_recorded",
                factSource: "runtime_coordinator_projection",
                idempotencyKey: "publication:blocker:failure",
                observedAtMs: 1_762_473_601_000,
                payloadJson: JSON.stringify({
                  publicationKind: "failure_notice",
                  reasonCode: "runtime_coordinator.publication_retry_exhausted",
                  status: "unresolved_publication_failure",
                  targetProfileId: "agt-demo",
                }),
                reasonCode: "runtime_coordinator.publication_unresolved",
                runtimeCoordinatorExecutionId: "rce-demo",
                statusAfter: null,
              },
            ],
          },
        },
      ] as const;

      for (const scenario of finalPublicationStateMatrix) {
        const parsed = spaceDispatchTraceResponseSchema.safeParse({
          ...VALID_TRACE_RESPONSE,
          correlation: {
            ...VALID_TRACE_RESPONSE.correlation,
            replySignalId:
              scenario.expected.status === "visible_reply" ? "sig-1" : null,
            runtimeCoordinatorExecutionId:
              "sourceFact" in scenario.expected &&
              scenario.expected.sourceFact === "runtime_coordinator_event"
                ? "rce-demo"
                : VALID_TRACE_RESPONSE.correlation
                    .runtimeCoordinatorExecutionId,
          },
          trace: scenario.trace,
        });
        if (!parsed.success) {
          throw new Error(
            `${scenario.name}: ${JSON.stringify(parsed.error.issues, null, 2)}`
          );
        }
        expect(parsed.success, scenario.name).toBe(true);
        if (!(parsed.success && parsed.data.trace)) {
          throw new Error(`expected parsed trace for ${scenario.name}`);
        }
        expect(
          projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace),
          scenario.name
        ).toMatchObject(scenario.expected);
      }
    });

    it("keeps final visible outcomes scoped per target when multi-target publication diverges", () => {
      const targetATrace = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          selector: {
            ...VALID_TRACE_RESPONSE.correlation.selector,
            dispatchId: "dispatch-target-a",
          },
          dispatchId: "dispatch-target-a",
          publishedSignalId: "sig-target-a-final",
          replySignalId: "sig-target-a-final",
          targetProfileId: "agt-target-a",
        },
        query: {
          ...VALID_TRACE_RESPONSE.query,
          dispatchId: "dispatch-target-a",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          dispatch: {
            ...VALID_TRACE_RESPONSE.trace.dispatch,
            dispatchId: "dispatch-target-a",
            targetProfileId: "agt-target-a",
          },
          latestAttempt: {
            ...VALID_TRACE_RESPONSE.trace.latestAttempt,
            dispatchId: "dispatch-target-a",
          },
          executionIdentity: {
            ...VALID_TRACE_RESPONSE.trace.executionIdentity,
            core: {
              ...VALID_TRACE_RESPONSE.trace.executionIdentity.core,
              dispatchId: "dispatch-target-a",
              targetProfileId: "agt-target-a",
            },
          },
          result: {
            ...VALID_TRACE_RESPONSE.trace.result,
            dispatchId: "dispatch-target-a",
            publishedSignalId: "sig-target-a-final",
          },
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            dispatchId: "dispatch-target-a",
            publishedSignalId: "sig-target-a-final",
            targetProfileId: "agt-target-a",
          },
          replySignal: {
            ...VALID_TRACE_RESPONSE.trace.replySignal,
            profileId: "agt-target-a",
            signalId: "sig-target-a-final",
          },
          finalVisibleMessage: {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-target-a-final",
            signalType: "signal.text",
            dispatchId: "dispatch-target-a",
            targetProfileId: "agt-target-a",
            profileId: "agt-target-a",
            profileKind: "agent",
            profileName: "Target A",
            text: "Target A replied.",
            reasonCode: null,
            noticeType: null,
            statusType: null,
            createdAt: "2026-03-09T00:00:04.000Z",
          },
        },
      });
      const targetBTrace = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          selector: {
            ...VALID_TRACE_RESPONSE.correlation.selector,
            dispatchId: "dispatch-target-b",
          },
          dispatchId: "dispatch-target-b",
          publishedSignalId: null,
          replySignalId: null,
          targetProfileId: "agt-target-b",
        },
        query: {
          ...VALID_TRACE_RESPONSE.query,
          dispatchId: "dispatch-target-b",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          dispatch: {
            ...VALID_TRACE_RESPONSE.trace.dispatch,
            dispatchId: "dispatch-target-b",
            targetProfileId: "agt-target-b",
          },
          latestAttempt: {
            ...VALID_TRACE_RESPONSE.trace.latestAttempt,
            dispatchId: "dispatch-target-b",
          },
          executionIdentity: {
            ...VALID_TRACE_RESPONSE.trace.executionIdentity,
            core: {
              ...VALID_TRACE_RESPONSE.trace.executionIdentity.core,
              dispatchId: "dispatch-target-b",
              targetProfileId: "agt-target-b",
            },
          },
          result: {
            ...VALID_TRACE_RESPONSE.trace.result,
            dispatchId: "dispatch-target-b",
            publishedSignalId: null,
          },
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            dispatchId: "dispatch-target-b",
            publicationErrorCode: "space.signal.persist_failed",
            publishedSignalId: null,
            publishState: "reply_publication_failed",
            targetProfileId: "agt-target-b",
          },
          replySignal: null,
          finalVisibleMessage: null,
        },
      });

      if (
        !(
          targetATrace.success &&
          targetBTrace.success &&
          targetATrace.data.trace &&
          targetBTrace.data.trace
        )
      ) {
        throw new Error(
          JSON.stringify(
            {
              targetA: targetATrace.success ? null : targetATrace.error.issues,
              targetB: targetBTrace.success ? null : targetBTrace.error.issues,
            },
            null,
            2
          )
        );
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(targetATrace.data.trace)
      ).toMatchObject({
        delivered: true,
        signalId: "sig-target-a-final",
        status: "visible_reply",
      });
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(targetBTrace.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "success_reply",
        reasonCode: "final_visible_outcome.publication_retrying",
        signalId: null,
        sourceFact: "result_inbox",
        status: "publication_retrying",
      });
    });

    it("accepts quarantined legacy result inbox diagnostics", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          resultRef: null,
          publishedSignalId: null,
          replySignalId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          result: null,
          resultInbox: {
            ...VALID_TRACE_RESPONSE.trace.resultInbox,
            publishState: "legacy_result_quarantined",
            publishedSignalId: null,
            publicationErrorCode:
              "runtime_coordinator.execution_token_required",
          },
          replySignal: null,
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts RuntimeCoordinator head no-execution trace without final publication", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          bindingId: null,
          agentControllerRef: null,
          claimLeaseId: null,
          latestAttemptId: null,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          openMeldServiceRuntimeId: null,
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          claimLease: null,
          dispatch: {
            ...VALID_TRACE_RESPONSE.trace.dispatch,
            latestAttemptId: null,
          },
          execution: null,
          executionIdentity: null,
          latestAttempt: null,
          replySignal: null,
          result: null,
          resultInbox: null,
          runtime: null,
          runtimeCoordinatorHeadLifecycle: {
            createdAt: "2026-03-09T00:00:01.100Z",
            duplicateDispatchCount: 0,
            executionLinkedAt: null,
            factSource: "runtime_coordinator_head_lifecycle",
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: {
              decidedAt: "2026-03-09T00:00:01.200Z",
              publicationCategory: "binding_required",
              reasonCode: "agent_profile_binding.missing",
              source: "dispatch_preflight",
              userRecoveryAction: "set_up_agent_binding",
            },
            ownerUserId: "owner-demo",
            primaryDispatchId: "dispatch-demo",
            publicationIntent: {
              intentId: "twl_space-demo_evt-1_agt-demo::no-execution-failure",
              kind: "no_execution_failure",
              publicationCategory: "binding_required",
              readyAt: "2026-03-09T00:00:01.300Z",
              reasonCode: "agent_profile_binding.missing",
              status: "ready_for_phase_6",
              userRecoveryAction: "set_up_agent_binding",
            },
            readStatus: "found",
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            targetWakeLifecycleIdentity: {
              clientMessageId: "client-message-demo",
              dispatchId: "dispatch-demo",
              modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
              sourceSignalId: "evt-1",
              spaceId: "space-demo",
              targetProfileId: "agt-demo",
              targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
            },
            targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
            updatedAt: "2026-03-09T00:00:01.300Z",
            waitingBoundary: null,
          },
        },
      });
      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "failure_notice",
        reasonCode: "final_visible_outcome.publication_pending",
        sourceFact: "runtime_coordinator_head_lifecycle",
        sourceReasonCode: "agent_profile_binding.missing",
        status: "publication_pending",
      });
    });

    it("accepts a final visible message published by RuntimeCoordinator head lifecycle", () => {
      const headTrace = {
        ...VALID_TRACE_RESPONSE.trace,
        claimLease: null,
        dispatch: {
          ...VALID_TRACE_RESPONSE.trace.dispatch,
          latestAttemptId: null,
        },
        execution: null,
        executionIdentity: null,
        finalVisibleMessage: {
          factSource: "space_signal_by_published_signal_id",
          signalId: "sig-head-failure-1",
          signalType: "signal.system_notice",
          dispatchId: "dispatch-demo",
          targetProfileId: "agt-demo",
          profileId: "openmeld-system",
          profileKind: "system",
          profileName: "OpenMeld",
          text: "This agent is connected to a different OpenMeld account.",
          reasonCode: "agent_profile_binding.owner_mismatch",
          noticeType: "terminal_failure",
          statusType: null,
          createdAt: "2026-03-09T00:00:01.500Z",
        },
        latestAttempt: null,
        replySignal: null,
        result: null,
        resultInbox: null,
        runtime: null,
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAt: "2026-03-09T00:00:01.200Z",
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.owner_mismatch",
            source: "dispatch_preflight",
            userRecoveryAction: "reconnect_agent_binding",
          },
          ownerUserId: "owner-demo",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: {
            intentId: "twl_space-demo_evt-1_agt-demo::no-execution-failure",
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAt: "2026-03-09T00:00:01.300Z",
            reasonCode: "agent_profile_binding.owner_mismatch",
            status: "ready_for_phase_6",
            userRecoveryAction: "reconnect_agent_binding",
          },
          publicationOutcome: {
            failurePublicationCommandId: "fpc-1",
            finalMessageKind: "failure_notice",
            observedAt: "2026-03-09T00:00:01.400Z",
            publicationErrorCode: null,
            publishedSignalId: "sig-head-failure-1",
            status: "failure_published",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-demo",
            dispatchId: "dispatch-demo",
            modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-demo",
            targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          },
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          updatedAt: "2026-03-09T00:00:01.500Z",
          waitingBoundary: null,
        },
      } as const;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          bindingId: null,
          agentControllerRef: null,
          claimLeaseId: null,
          latestAttemptId: null,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          openMeldServiceRuntimeId: null,
        },
        trace: headTrace,
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: true,
        publicationKind: "failure_notice",
        reasonCode: "agent_profile_binding.owner_mismatch",
        signalId: "sig-head-failure-1",
        sourceFact: "final_visible_message",
        status: "visible_failure",
      });
      expect(
        listSpaceDispatchTraceFinalVisibleSignalCandidates(parsed.data.trace)
      ).toEqual(["sig-head-failure-1"]);
    });

    it("lists final visible signal candidates in authoritative publication order", () => {
      const trace = {
        ...VALID_TRACE_RESPONSE.trace,
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: null,
          ownerUserId: "owner-demo",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: null,
          publicationOutcome: {
            failurePublicationCommandId: "fpc-1",
            finalMessageKind: "failure_notice",
            observedAt: "2026-03-09T00:00:01.400Z",
            publicationErrorCode: null,
            publishedSignalId: "sig-head-failure-1",
            status: "failure_published",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "accepted",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-demo",
            dispatchId: "dispatch-demo",
            modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-demo",
            targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          },
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          updatedAt: "2026-03-09T00:00:01.500Z",
          waitingBoundary: null,
        },
        result: {
          ...VALID_TRACE_RESPONSE.trace.result,
          publishedSignalId: "sig-result-1",
        },
        resultInbox: {
          ...VALID_TRACE_RESPONSE.trace.resultInbox,
          publishedSignalId: "sig-inbox-1",
        },
      } as const;

      expect(listSpaceDispatchTraceFinalVisibleSignalCandidates(trace)).toEqual(
        ["sig-head-failure-1", "sig-result-1", "sig-inbox-1"]
      );
    });

    it("projects head failure publication failure as not-delivered retrying final outcome", () => {
      const headTrace = {
        ...VALID_TRACE_RESPONSE.trace,
        claimLease: null,
        dispatch: {
          ...VALID_TRACE_RESPONSE.trace.dispatch,
          latestAttemptId: null,
        },
        execution: null,
        executionIdentity: null,
        latestAttempt: null,
        replySignal: null,
        result: null,
        resultInbox: null,
        runtime: null,
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAt: "2026-03-09T00:00:01.200Z",
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.missing",
            source: "dispatch_preflight",
            userRecoveryAction: "set_up_agent_binding",
          },
          ownerUserId: "owner-demo",
          primaryDispatchId: "dispatch-demo",
          publicationIntent: {
            intentId: "twl_space-demo_evt-1_agt-demo::no-execution-failure",
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAt: "2026-03-09T00:00:01.300Z",
            reasonCode: "agent_profile_binding.missing",
            status: "ready_for_phase_6",
            userRecoveryAction: "set_up_agent_binding",
          },
          publicationOutcome: {
            failurePublicationCommandId: "fpc-1",
            finalMessageKind: "failure_notice",
            observedAt: "2026-03-09T00:00:01.400Z",
            publicationErrorCode: "space.signal.persist_failed",
            publishedSignalId: null,
            status: "failure_publication_failed",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-demo",
            dispatchId: "dispatch-demo",
            modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-demo",
            targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          },
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          updatedAt: "2026-03-09T00:00:01.400Z",
          waitingBoundary: null,
        },
      } as const;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          bindingId: null,
          agentControllerRef: null,
          claimLeaseId: null,
          latestAttemptId: null,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          openMeldServiceRuntimeId: null,
        },
        trace: headTrace,
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "failure_notice",
        reasonCode: "final_visible_outcome.publication_retrying",
        sourceFact: "runtime_coordinator_head_lifecycle",
        sourceReasonCode: "space.signal.persist_failed",
        status: "publication_retrying",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_retrying",
        source: "final_visible_outcome",
      });
    });

    it("projects head failure publication exhaustion as unresolved without an execution record", () => {
      const headTrace = {
        ...VALID_TRACE_RESPONSE.trace,
        claimLease: null,
        dispatch: {
          ...VALID_TRACE_RESPONSE.trace.dispatch,
          latestAttemptId: null,
        },
        execution: null,
        executionIdentity: null,
        finalVisibleMessage: null,
        latestAttempt: null,
        runtime: null,
        runtimeCoordinatorExecution: null,
        runtimeCoordinatorHeadLifecycle: {
          createdAt: "2026-03-09T00:00:01.100Z",
          duplicateDispatchCount: 0,
          executionLinkedAt: null,
          factSource: "runtime_coordinator_head_lifecycle",
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAt: "2026-03-09T00:00:01.200Z",
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.missing",
            source: "dispatch_preflight",
            userRecoveryAction: "set_up_agent_binding",
          },
          ownerUserId: "owner-demo",
          primaryDispatchId: "dispatch-demo",
          publicationExhaustion: {
            attemptCount: 3,
            exhaustedAt: "2026-03-09T00:05:02.000Z",
            lastFailureAt: "2026-03-09T00:05:01.000Z",
            lastReasonCode:
              "runtime_coordinator.failure_publication_unavailable",
            reasonCode: "runtime_coordinator.publication_retry_exhausted",
            status: "publication_exhausted",
          },
          publicationIntent: {
            intentId: "twl_space-demo_evt-1_agt-demo::no-execution-failure",
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAt: "2026-03-09T00:00:01.300Z",
            reasonCode: "agent_profile_binding.missing",
            status: "ready_for_phase_6",
            userRecoveryAction: "set_up_agent_binding",
          },
          publicationOutcome: {
            failurePublicationCommandId: "fpc-1",
            finalMessageKind: null,
            observedAt: "2026-03-09T00:05:01.000Z",
            publicationErrorCode:
              "runtime_coordinator.failure_publication_unavailable",
            publishedSignalId: null,
            status: "failure_publication_failed",
          },
          readStatus: "found",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity: {
            clientMessageId: "client-message-demo",
            dispatchId: "dispatch-demo",
            modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
            sourceSignalId: "evt-1",
            spaceId: "space-demo",
            targetProfileId: "agt-demo",
            targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          },
          targetWakeLifecycleId: "twl_v1|10:space-demo|5:evt-1|8:agt-demo",
          updatedAt: "2026-03-09T00:05:02.000Z",
          waitingBoundary: null,
        },
        result: null,
        resultInbox: null,
        replySignal: null,
      } as const;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          bindingId: null,
          agentControllerRef: null,
          claimLeaseId: null,
          latestAttemptId: null,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          runtimeCoordinatorExecutionId: null,
          openMeldServiceRuntimeId: null,
        },
        trace: headTrace,
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "failure_notice",
        reasonCode: "final_visible_outcome.publication_unresolved",
        sourceFact: "runtime_coordinator_head_lifecycle",
        sourceReasonCode: "runtime_coordinator.publication_retry_exhausted",
        sourceStatus: "publication_exhausted",
        status: "publication_unresolved",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_unresolved",
        source: "final_visible_outcome",
      });
    });

    it("does not treat delivery-expired terminal execution as user-visible closure without a final message", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          runtimeCoordinatorExecutionId: "rce-delivery-expired",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          result: null,
          resultInbox: null,
          replySignal: null,
          finalVisibleMessage: null,
          runtimeCoordinatorExecution: {
            bindingId: "binding-demo",
            agentControllerRef: "builtin:codex",
            createdAtMs: 1_762_473_599_000,
            dispatchId: "dispatch-demo",
            factSource: "runtime_coordinator_projection",
            legacyPointers: {
              attemptId: "attempt-2",
              claimLeaseId: null,
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              leaseEpoch: 3,
            },
            modelVersion: "openmeld.runtime_coordinator.execution.v1",
            runtimeCoordinatorExecutionId: "rce-delivery-expired",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-demo",
            },
            sourceClientMessageId: "client-message-demo",
            spaceId: "space-demo",
            status: "failed_terminal",
            targetProfileId: "agt-demo",
            terminalOutcome: {
              kind: "failed_terminal",
              observedAtMs: 1_762_473_604_000,
              reasonCode: "runtime_coordinator.delivery_expired",
            },
            updatedAtMs: 1_762_473_604_000,
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "failure_notice",
        reasonCode: "final_visible_outcome.publication_unresolved",
        sourceFact: "runtime_coordinator_execution",
        sourceReasonCode: "runtime_coordinator.delivery_expired",
        status: "publication_unresolved",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_unresolved",
        source: "final_visible_outcome",
      });
    });

    it("does not treat RuntimeCoordinator reply_published as visible closure without a final message", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          publishedSignalId: null,
          replySignalId: null,
          resultRef: null,
          runtimeCoordinatorExecutionId: "rce-reply-published-missing-final",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          result: null,
          resultInbox: null,
          replySignal: null,
          finalVisibleMessage: null,
          runtimeCoordinatorExecution: {
            bindingId: "binding-demo",
            agentControllerRef: "builtin:codex",
            createdAtMs: 1_762_473_599_000,
            dispatchId: "dispatch-demo",
            factSource: "runtime_coordinator_projection",
            legacyPointers: {
              attemptId: "attempt-2",
              claimLeaseId: null,
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              leaseEpoch: 3,
            },
            modelVersion: "openmeld.runtime_coordinator.execution.v1",
            runtimeCoordinatorExecutionId: "rce-reply-published-missing-final",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-demo",
            },
            sourceClientMessageId: "client-message-demo",
            spaceId: "space-demo",
            status: "reply_published",
            targetProfileId: "agt-demo",
            terminalOutcome: {
              kind: "reply_published",
              observedAtMs: 1_762_473_604_000,
              reasonCode: null,
            },
            updatedAtMs: 1_762_473_604_000,
          },
        },
      });

      expect(parsed.success).toBe(true);
      if (!(parsed.success && parsed.data.trace)) {
        throw new Error("expected parsed trace");
      }
      expect(
        projectSpaceDispatchTraceFinalVisibleOutcome(parsed.data.trace)
      ).toMatchObject({
        delivered: false,
        publicationKind: "success_reply",
        reasonCode: "final_visible_outcome.publication_unresolved",
        sourceFact: "runtime_coordinator_execution",
        sourceReasonCode: "reply.not_found",
        sourceStatus: "reply_published",
        status: "publication_unresolved",
      });
      expect(projectSpaceDispatchTraceRootCause(parsed.data.trace)).toEqual({
        reasonCode: "final_visible_outcome.publication_unresolved",
        source: "final_visible_outcome",
      });
    });

    it("accepts not-found trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        correlation: {
          modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
          selector: {
            kind: "dispatch",
            spaceId: "space-demo",
            dispatchId: "dispatch-missing",
          },
          spaceId: "space-demo",
          clientMessageId: null,
          sourceSignalId: null,
          targetProfileId: null,
          dispatchId: "dispatch-missing",
          runtimeCoordinatorExecutionId: null,
          latestAttemptId: null,
          claimLeaseId: null,
          bindingId: null,
          openMeldServiceRuntimeId: null,
          agentControllerRef: null,
          resultRef: null,
          publishedSignalId: null,
          replySignalId: null,
          cloudflare: {
            cfRayId: null,
            requestId: null,
            traceId: null,
          },
        },
        query: {
          spaceId: "space-demo",
          dispatchId: "dispatch-missing",
        },
        trace: null,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects dispatch trace payload when correlation drifts from query", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          selector: {
            kind: "dispatch",
            spaceId: "space-demo",
            dispatchId: "dispatch-other",
          },
          dispatchId: "dispatch-other",
        },
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects dispatch trace payload when correlation drifts from trace facts", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          sourceSignalId: "evt-other",
        },
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects not-found trace payload when correlation carries resolved evidence", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        correlation: {
          modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
          selector: {
            kind: "dispatch",
            spaceId: "space-demo",
            dispatchId: "dispatch-missing",
          },
          spaceId: "space-demo",
          clientMessageId: "client-message-demo",
          sourceSignalId: null,
          targetProfileId: null,
          dispatchId: "dispatch-missing",
          runtimeCoordinatorExecutionId: null,
          latestAttemptId: null,
          claimLeaseId: null,
          bindingId: null,
          openMeldServiceRuntimeId: null,
          agentControllerRef: null,
          resultRef: null,
          publishedSignalId: null,
          replySignalId: null,
          cloudflare: {
            cfRayId: null,
            requestId: null,
            traceId: null,
          },
        },
        query: {
          spaceId: "space-demo",
          dispatchId: "dispatch-missing",
        },
        trace: null,
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects invalid latest attempt status", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          latestAttempt: {
            ...VALID_TRACE_RESPONSE.trace.latestAttempt,
            status: "replayed",
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects latest attempt when connectionGeneration is missing", () => {
      const {
        connectionGeneration: _connectionGeneration,
        ...latestAttemptWithoutConnectionGeneration
      } = VALID_TRACE_RESPONSE.trace.latestAttempt;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          latestAttempt: latestAttemptWithoutConnectionGeneration,
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects trace payload when runtime is missing", () => {
      const { runtime: _runtime, ...traceWithoutRuntime } =
        VALID_TRACE_RESPONSE.trace;
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: traceWithoutRuntime,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects unknown fields in trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        extra: true,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects legacy conversation lifecycle fields", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          conversation: {
            compatibilityAction: "reuse",
            compatibilityReason: "compatible",
            continuityStatus: "stable_resume",
            bootstrapApplied: false,
            bootstrapReason: null,
            bootstrapTemplateVersion: "compact-dispatch-bootstrap-v1",
            bootstrapContentFingerprint: "sha256:abc",
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts structured action diagnostics in trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          structuredActionFailure: {
            carrierKind: "none",
            invalidOutputPreview: "hi",
            publicFailureReason:
              "A valid OpenMeld Space action is required in collaboration mode.",
            repairMode: "controller_roundtrip",
            spaceActionCandidatePresent: false,
            spaceActionParseError: null,
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts token status and ignored-result diagnostics without token secrets", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          runtimeCoordinatorExecutionId: "rce-demo",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          runtimeCoordinatorExecution: {
            bindingId: "binding-demo",
            agentControllerRef: "builtin:codex",
            createdAtMs: 1_762_473_599_000,
            dispatchId: "dispatch-demo",
            factSource: "runtime_coordinator_projection",
            legacyPointers: {
              attemptId: "attempt-2",
              claimLeaseId: null,
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              leaseEpoch: 3,
            },
            modelVersion: "openmeld.runtime_coordinator.execution.v1",
            runtimeCoordinatorExecutionId: "rce-demo",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-demo",
            },
            sourceClientMessageId: "client-message-demo",
            spaceId: "space-demo",
            status: "delivery_accepted",
            targetProfileId: "agt-demo",
            terminalOutcome: null,
            updatedAtMs: 1_762_473_600_000,
          },
          runtimeCoordinatorEvents: [
            {
              eventId: "event-token-issued",
              eventType: "execution_token_issued",
              factSource: "runtime_coordinator_projection",
              idempotencyKey: "rce-demo::run-1",
              observedAtMs: 1_762_473_600_000,
              payloadJson: JSON.stringify({
                runId: "run-1",
                tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaa",
                tokenStatus: "active",
              }),
              reasonCode: "execution_token_issued",
              runtimeCoordinatorExecutionId: "rce-demo",
              statusAfter: "delivery_accepted",
            },
            {
              eventId: "event-token-stale",
              eventType: "execution_token_validation_failed",
              factSource: "runtime_coordinator_projection",
              idempotencyKey: "rce-demo::run-0::late-result",
              observedAtMs: 1_762_473_601_000,
              payloadJson: JSON.stringify({
                ignoredEventSummary: "late result ignored",
                runId: "run-0",
                tokenFingerprint: "etfp_v1_bbbbbbbbbbbbbbbb",
                tokenStatus: "superseded",
              }),
              reasonCode: "execution_token_superseded",
              runtimeCoordinatorExecutionId: "rce-demo",
              statusAfter: null,
            },
          ],
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects dispatch trace payload when correlation execution id drifts from RuntimeCoordinator evidence", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        correlation: {
          ...VALID_TRACE_RESPONSE.correlation,
          runtimeCoordinatorExecutionId: "rce-other",
        },
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          runtimeCoordinatorExecution: {
            bindingId: "binding-demo",
            agentControllerRef: "builtin:codex",
            createdAtMs: 1_762_473_599_000,
            dispatchId: "dispatch-demo",
            factSource: "runtime_coordinator_projection",
            legacyPointers: {
              attemptId: "attempt-2",
              claimLeaseId: null,
              connectionGeneration: 1,
              daemonSessionId: "daemon-session-1",
              leaseEpoch: 3,
            },
            modelVersion: "openmeld.runtime_coordinator.execution.v1",
            runtimeCoordinatorExecutionId: "rce-demo",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-demo",
            },
            sourceClientMessageId: "client-message-demo",
            spaceId: "space-demo",
            status: "delivery_accepted",
            targetProfileId: "agt-demo",
            terminalOutcome: null,
            updatedAtMs: 1_762_473_600_000,
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects token secrets inside dispatch trace runtime coordinator events", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          runtimeCoordinatorEvents: [
            {
              eventId: "event-token-secret",
              eventType: "execution_token_validation_failed",
              factSource: "runtime_coordinator_projection",
              idempotencyKey: "rce-demo::run-1::raw",
              observedAtMs: 1_762_473_601_000,
              payloadJson: JSON.stringify({
                executionToken: "rcet_v1_abcdefghijklmnopqrstuvwxyz123456",
                tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaa",
              }),
              reasonCode: "execution_token_mismatch",
              runtimeCoordinatorExecutionId: "rce-demo",
              statusAfter: null,
            },
          ],
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts origin and prompt diagnostics in trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          origin: {
            agentControllerConversationId: "session-demo-2",
            agentControllerRef: "openclaw",
            agentControllerConversationKind: "session",
            resolvedAgentControllerConversationId: "agent:demo:space:demo-2",
            effectiveRuntimeWorkingDirectory: "/tmp/demo",
            runtimeWorkspaceFingerprint: "sha256:demo-workspace",
          },
          prompt: {
            fingerprint: "sha256:prompt-demo-2",
            length: 640,
            preview: "Space Dispatch Brief",
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts OpenClaw gateway visibility diagnostics in trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          openClawGatewayVisibility: {
            agentId: "openmeld-demo-bot",
            gatewayRestartAttempted: true,
            gatewayVisibility: "visible_after_restart",
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts OpenClaw binding diagnostics in trace payload", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          openClawBinding: {
            classification: "legacy",
            bindingSource: "daemon-launch",
            upgradeApplied: true,
          },
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects negative execution timeout values", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          execution: {
            ...VALID_TRACE_RESPONSE.trace.execution,
            timeoutPolicy: {
              ...VALID_TRACE_RESPONSE.trace.execution.timeoutPolicy,
              startTimeoutMs: -1,
            },
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects negative prompt lengths", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          prompt: {
            ...VALID_TRACE_RESPONSE.trace.prompt,
            length: -1,
          },
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects prompt previews that exceed the bounded preview limit", () => {
      const parsed = spaceDispatchTraceResponseSchema.safeParse({
        ...VALID_TRACE_RESPONSE,
        trace: {
          ...VALID_TRACE_RESPONSE.trace,
          prompt: {
            ...VALID_TRACE_RESPONSE.trace.prompt,
            preview: "x".repeat(
              SPACE_DISPATCH_TRACE_PROMPT_PREVIEW_MAX_CHARS + 1
            ),
          },
        },
      });
      expect(parsed.success).toBe(false);
    });
  });
});

function buildAgentAgentWakeAvailability(
  status:
    | "available_for_wake"
    | "checking_connection"
    | "offline_for_wake"
    | "unavailable_for_wake"
) {
  switch (status) {
    case "available_for_wake":
      return {
        action: "none",
        badgeLabel: "Available",
        category: "available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        reasonCode: "agent_execution.ready",
        status,
        summary: "Available for Wake",
        tooltip: "Available for Wake",
      };
    case "unavailable_for_wake":
      return {
        action: "reconnect_binding",
        badgeLabel: "Connect",
        category: "unavailable",
        isRefreshing: false,
        label: "Connect local agent",
        phase: "connect_local_agent",
        reasonCode: "agent_profile_binding.missing",
        status,
        summary: "Connect a local agent before this profile can reply.",
        tooltip: "Connect local agent",
      };
    case "offline_for_wake":
      return {
        action: "connect_service",
        badgeLabel: "Offline",
        category: "offline",
        isRefreshing: false,
        label: "Offline for Wake",
        phase: "service_not_connected",
        reasonCode: "service.not_running",
        status,
        summary: "Connect your computer before this Agent can reply.",
        tooltip: "OpenMeld Service is not connected on this computer.",
      };
    case "checking_connection":
      return {
        action: "check_status",
        badgeLabel: "Checking",
        category: "checking",
        isRefreshing: true,
        label: "Checking connection",
        phase: "checking_status",
        reasonCode: "agent_execution.check_status",
        status,
        summary: "Checking this agent's Wake availability.",
        tooltip: "Checking Wake availability",
      };
    default:
      throw new Error(`Unhandled agent wake availability status: ${status}`);
  }
}

function buildAgentWakeRouteRegistration() {
  return {
    status: "registered",
    reasonCode: null,
    reportedAtMs: 1_777_000_000_000,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    serviceVersion: "0.7.57",
  };
}
