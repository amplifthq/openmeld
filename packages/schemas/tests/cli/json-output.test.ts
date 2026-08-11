import { describe, expect, it } from "vitest";
import {
  CLI_JSON_OUTPUT_SCHEMA_VERSION,
  CLI_JSON_OUTPUT_TYPES,
  cliJsonEntryCheckBlockedErrorCodeSchema,
  cliJsonErrorEnvelopeSchema,
  cliJsonFeedbackSubmittedEnvelopeSchema,
  cliJsonOrganizationDirectoryEnvelopeSchema,
  cliJsonOutputEnvelopeSchema,
  cliJsonProjectsConnectionsListEnvelopeSchema,
  cliJsonProjectsConnectionsRemoveEnvelopeSchema,
  cliJsonProjectsConnectionsSetDefaultEnvelopeSchema,
  cliJsonRoutinesCreateEnvelopeSchema,
  cliJsonRoutinesDeleteEnvelopeSchema,
  cliJsonRoutinesListEnvelopeSchema,
  cliJsonRoutinesPauseEnvelopeSchema,
  cliJsonRoutinesResumeEnvelopeSchema,
  cliJsonRoutinesRunsEnvelopeSchema,
  cliJsonRoutinesShowEnvelopeSchema,
  cliJsonRoutinesUpdateEnvelopeSchema,
  cliJsonSpaceListOrganizationEnvelopeSchema,
  cliJsonSpaceMembersEnvelopeSchema,
} from "../../src/index";

const VERSION = CLI_JSON_OUTPUT_SCHEMA_VERSION;
const ROUTINE = {
  canManage: true,
  createdAtMs: 1_789_000_000_000,
  createdByUserId: "user-1",
  cronExpression: "0 9 * * *",
  id: "routine-1",
  instructions: "Triage the Feedback Inbox.",
  lastRun: null,
  name: "Daily feedback triage",
  nextDueAt: 1_789_086_000_000,
  organizationId: "org-1",
  scheduleKind: "cron" as const,
  status: "enabled" as const,
  targetSpaceId: "space-1",
  timezone: "America/Los_Angeles",
  updatedAtMs: 1_789_000_000_000,
  updatedByUserId: "user-1",
};
const ROUTINE_RUN = {
  failureCode: null,
  failureDetail: null,
  finishedAtMs: 1_789_086_030_000,
  id: "run-1",
  nativeDeliveryId: "delivery-1",
  organizationId: "org-1",
  publishedSignalId: "signal-1",
  routineId: ROUTINE.id,
  scheduledFor: 1_789_086_000_000,
  startedAtMs: 1_789_086_000_000,
  status: "completed" as const,
};
const SPACE_MEMBER_DIRECTORY = {
  spaceId: "space-123",
  generatedAt: "2026-04-03T00:00:00.000Z",
  members: [
    {
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileKind: "agent" as const,
      displayName: "Mira Codex",
      primaryMentionLabel: "Mira Codex",
      mentionLabels: ["Mira Codex"],
      mentionAlias: "codex",
      labelSource: "profile_name" as const,
      lookupTokens: ["mira codex", "codex"],
      preferredLookupToken: "mira codex",
      profileIdShort: "agt_11111",
      allowedRelations: {
        wake: true,
        reference: true,
      },
      ownerUserId: "owner-1",
      ownerName: "Mira",
      agentCard: null,
      spaceRole: null,
    },
  ],
};
const ORGANIZATION_SPACE_LIST = {
  scope: "organization" as const,
  organizationId: "org-1",
  generatedAt: "2026-07-20T12:00:00.000Z",
  total: 2,
  returned: 1,
  spaces: [
    {
      spaceId: "space-public",
      name: "Public Room",
      organizationId: "org-1",
      visibility: "public" as const,
      joined: false,
      lastJoinedAt: null,
      spaceCreatedAt: "2026-07-19T12:00:00.000Z",
      spaceUpdatedAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:00.000Z",
      activeMemberCount: 3,
    },
  ],
};

describe("cli --json output envelope contract", () => {
  describe("success cases", () => {
    it("accepts the error envelope without a requestId", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "error",
        error: { code: "cli.error", message: "boom" },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts the error envelope with a requestId", () => {
      const parsed = cliJsonErrorEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "error",
        error: {
          code: "gateway.invalid_response",
          message: "bad response",
          requestId: "req_123",
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts every documented success envelope with its flattened payload", () => {
      const samples = [
        { schemaVersion: VERSION, type: "daemon.run", ok: true, reason: null },
        {
          schemaVersion: VERSION,
          type: "daemon.install",
          status: "installed",
          state: { daemonVersion: "0.7.63" },
          runtimeProjection: { status: "running" },
        },
        {
          schemaVersion: VERSION,
          type: "daemon.install",
          status: "downgrade_blocked",
          installedVersion: "0.7.63",
          requestedVersion: "0.7.10",
          upgradeCommand: "openmeld upgrade",
        },
        { schemaVersion: VERSION, type: "daemon.uninstall", status: "removed" },
        {
          schemaVersion: VERSION,
          type: "daemon.uninstall",
          status: "not_installed",
        },
        {
          schemaVersion: VERSION,
          type: "daemon.reinstall",
          action: "repair",
          outcome: "completed",
        },
        {
          schemaVersion: VERSION,
          type: "daemon.status",
          localResult: {},
          result: {},
          runtimeProjection: null,
        },
        {
          schemaVersion: VERSION,
          type: "daemon.stop",
          status: "stopped",
        },
        {
          schemaVersion: VERSION,
          type: "daemon.autostart",
          action: "enable",
          enabled: true,
        },
        {
          schemaVersion: VERSION,
          type: "agents.detect",
          detectedAgents: [],
          count: 0,
          inventorySource: "local_runtime_inventory",
          source: "builtin_detect",
        },
        {
          schemaVersion: VERSION,
          type: "agents.list",
          registrations: [],
          count: 0,
        },
        {
          schemaVersion: VERSION,
          type: "agents.show",
          agent: { agentId: "codex", displayName: "Codex" },
          agentControllerInterface: null,
          effectiveConfig: {},
          installChoices: [],
          launchStatus: "available",
          launchStatusDetail: null,
        },
        {
          schemaVersion: VERSION,
          type: "agents.enable",
          requested: ["claude"],
          registered: ["claude"],
          reenabled: [],
          skipped: [],
          errors: [],
          allMode: false,
        },
        {
          schemaVersion: VERSION,
          type: "agents.disable",
          requested: ["claude"],
          disabled: ["claude"],
          skipped: [],
          errors: [],
          allMode: false,
        },
        {
          schemaVersion: VERSION,
          type: "feedback_submitted",
          issueId: "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69",
          category: "experience",
          submitterKind: "local_agent",
          anonymous: true,
        },
        {
          schemaVersion: VERSION,
          type: "activity.read",
          asOfMs: 1000,
          digests: [],
          digestsTruncated: false,
          organizationId: "org-1",
          projects: [],
          recentEvents: [],
          sessions: [],
          sessionsTruncated: false,
          stalenessThresholdMs: 300_000,
        },
        {
          schemaVersion: VERSION,
          type: "activity.install",
          integrations: {
            claude: "changed",
            codex: "reused",
            cursor: "changed",
            openCode: "changed",
          },
        },
        {
          schemaVersion: VERSION,
          type: "activity.uninstall",
          integrations: {
            claude: "changed",
            codex: "missing",
            cursor: "reused",
            openCode: "reused",
          },
        },
        {
          schemaVersion: VERSION,
          type: "activity.status",
          controllerTaskHealth: {
            pending: 1,
            permanentlyRejected: 0,
            retrying: 0,
          },
          health: { pending: 0, permanentlyRejected: 0, retrying: 0 },
          integrations: {
            claude: true,
            codex: true,
            cursor: true,
            openCode: false,
          },
        },
        {
          schemaVersion: VERSION,
          type: "activity.health",
          controllerTaskHealth: {
            pending: 0,
            permanentlyRejected: 1,
            retrying: 1,
          },
          health: { pending: 2, permanentlyRejected: 1, retrying: 1 },
        },
        {
          schemaVersion: VERSION,
          type: "activity.sync",
          result: {
            controllerTaskEventSubmittedCount: 1,
            controllerTaskHealth: {
              pending: 0,
              permanentlyRejected: 0,
              retrying: 0,
            },
            health: { pending: 0, permanentlyRejected: 0, retrying: 0 },
            observedCount: 2,
            reason: null,
            status: "submitted",
            submittedCount: 2,
          },
        },
        {
          schemaVersion: VERSION,
          type: "activity.context",
          context: null,
        },
        {
          schemaVersion: VERSION,
          type: "routines.list",
          currentUserId: "user-1",
          organizationId: "org-1",
          routines: [ROUTINE],
        },
        {
          schemaVersion: VERSION,
          type: "routines.create",
          routine: ROUTINE,
        },
        {
          schemaVersion: VERSION,
          type: "routines.show",
          routine: ROUTINE,
        },
        {
          schemaVersion: VERSION,
          type: "routines.update",
          routine: ROUTINE,
        },
        {
          schemaVersion: VERSION,
          type: "routines.pause",
          routine: { ...ROUTINE, nextDueAt: null, status: "paused" },
        },
        {
          schemaVersion: VERSION,
          type: "routines.resume",
          routine: ROUTINE,
        },
        {
          schemaVersion: VERSION,
          type: "routines.delete",
          deleted: true,
          organizationId: "org-1",
          routineId: ROUTINE.id,
        },
        {
          schemaVersion: VERSION,
          type: "routines.runs",
          organizationId: "org-1",
          routineId: ROUTINE.id,
          runs: [ROUTINE_RUN],
        },
        {
          schemaVersion: VERSION,
          type: "space.members",
          ...SPACE_MEMBER_DIRECTORY,
        },
        {
          schemaVersion: VERSION,
          type: "space.list.organization",
          ...ORGANIZATION_SPACE_LIST,
        },
        {
          schemaVersion: VERSION,
          type: "organization.directory",
          organizationId: "org-1",
          generatedAt: "2026-07-19T12:00:00.000Z",
          members: [],
          agentProfiles: [],
        },
        {
          schemaVersion: VERSION,
          type: "organization.invite_link.get",
          ok: true,
          joinLink: null,
        },
        {
          schemaVersion: VERSION,
          type: "organization.invite_link.create",
          ok: true,
          joinLink: null,
        },
        {
          schemaVersion: VERSION,
          type: "organization.invite_link.revoke",
          ok: true,
          revoked: true,
        },
      ];
      for (const sample of samples) {
        const parsed = cliJsonOutputEnvelopeSchema.safeParse(sample);
        expect(parsed.success, `expected ${sample.type} to parse`).toBe(true);
      }
    });

    it("freezes strict Project connection command snapshots", () => {
      const common = {
        connections: [
          {
            bindingGeneration: "binding-1",
            isDefault: true,
            path: "/Users/felix/work/openmeld",
            status: "available",
          },
          {
            bindingGeneration: "binding-2",
            isDefault: false,
            path: "/Users/felix/work/openmeld-feature",
            status: "missing",
          },
        ],
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "openmeld",
        schemaVersion: VERSION,
      } as const;
      const samples = [
        [
          cliJsonProjectsConnectionsListEnvelopeSchema,
          { ...common, type: "projects.connections.list" },
        ],
        [
          cliJsonProjectsConnectionsSetDefaultEnvelopeSchema,
          {
            ...common,
            status: "updated",
            type: "projects.connections.set_default",
          },
        ],
        [
          cliJsonProjectsConnectionsRemoveEnvelopeSchema,
          {
            ...common,
            status: "removed",
            type: "projects.connections.remove",
          },
        ],
      ] as const;
      for (const [schema, sample] of samples) {
        expect(schema.safeParse(sample)).toMatchObject({ success: true });
        expect(schema.safeParse({ ...sample, extra: true })).toMatchObject({
          success: false,
        });
        expect(cliJsonOutputEnvelopeSchema.safeParse(sample)).toMatchObject({
          success: true,
        });
      }
    });

    it("relaxes the flattened success payload (extra domain keys pass)", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "daemon.stop",
        status: "stopped",
        someFutureDomainField: { nested: true },
      });
      expect(parsed.success).toBe(true);
    });

    it("validates serverRequirement when daemon status includes it", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "daemon.status",
        serverRequirement: { available: true },
      });

      expect(parsed.success).toBe(false);
    });

    it("re-exports every Routine envelope with the shared HTTP response payload", () => {
      const samples = [
        [
          cliJsonRoutinesListEnvelopeSchema,
          {
            schemaVersion: VERSION,
            type: "routines.list",
            currentUserId: "user-1",
            organizationId: "org-1",
            routines: [ROUTINE],
          },
        ],
        [
          cliJsonRoutinesCreateEnvelopeSchema,
          { schemaVersion: VERSION, type: "routines.create", routine: ROUTINE },
        ],
        [
          cliJsonRoutinesShowEnvelopeSchema,
          { schemaVersion: VERSION, type: "routines.show", routine: ROUTINE },
        ],
        [
          cliJsonRoutinesUpdateEnvelopeSchema,
          { schemaVersion: VERSION, type: "routines.update", routine: ROUTINE },
        ],
        [
          cliJsonRoutinesPauseEnvelopeSchema,
          {
            schemaVersion: VERSION,
            type: "routines.pause",
            routine: { ...ROUTINE, nextDueAt: null, status: "paused" },
          },
        ],
        [
          cliJsonRoutinesResumeEnvelopeSchema,
          { schemaVersion: VERSION, type: "routines.resume", routine: ROUTINE },
        ],
        [
          cliJsonRoutinesDeleteEnvelopeSchema,
          {
            schemaVersion: VERSION,
            type: "routines.delete",
            deleted: true,
            organizationId: "org-1",
            routineId: ROUTINE.id,
          },
        ],
        [
          cliJsonRoutinesRunsEnvelopeSchema,
          {
            schemaVersion: VERSION,
            type: "routines.runs",
            organizationId: "org-1",
            routineId: ROUTINE.id,
            runs: [ROUTINE_RUN],
          },
        ],
      ] as const;

      for (const [schema, sample] of samples) {
        expect(schema.safeParse(sample).success, sample.type).toBe(true);
      }
    });
  });

  describe("failure cases", () => {
    it("rejects an unknown envelope type", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "hints",
        hints: [],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects a wrong schemaVersion", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: 2,
        type: "daemon.run",
        ok: true,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects a missing discriminant", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        ok: true,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects unknown keys on the strict error envelope", () => {
      const parsed = cliJsonErrorEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "error",
        error: { code: "cli.error", message: "boom" },
        extra: "nope",
      });
      expect(parsed.success).toBe(false);
    });

    it.each([
      ["HTTP status", { status: 200 }],
      ["upstream code", { upstreamCode: "scheduler.capacity_unknown" }],
      ["schema issue message", { schemaIssueMessage: "Invalid option" }],
      ["schema issue path", { schemaIssuePath: "routines.0.status" }],
      ["raw response body", { rawBody: "secret" }],
    ])("rejects extra v1 error fields: %s", (_name, field) => {
      const parsed = cliJsonErrorEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "error",
        error: {
          code: "gateway.invalid_response",
          message: "bad response",
          ...field,
        },
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects a malformed daemon.uninstall status", () => {
      const parsed = cliJsonOutputEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "daemon.uninstall",
        status: "vanished",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects feedback_submitted without its required result fields", () => {
      const parsed = cliJsonFeedbackSubmittedEnvelopeSchema.safeParse({
        schemaVersion: VERSION,
        type: "feedback_submitted",
        issueId: "feedback_issue_f4980202-efe0-467c-bcc3-92760fce0c69",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects Routine envelopes that drift from their shared response schemas", () => {
      expect(
        cliJsonRoutinesListEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "routines.list",
          organizationId: "org-1",
          routines: [ROUTINE],
        }).success
      ).toBe(false);
      expect(
        cliJsonRoutinesShowEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "routines.show",
          routine: { ...ROUTINE, inventedField: true },
        }).success
      ).toBe(false);
      expect(
        cliJsonRoutinesDeleteEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "routines.delete",
          deleted: true,
          organizationId: "org-1",
          routineId: ROUTINE.id,
          inventedField: true,
        }).success
      ).toBe(false);
    });

    it("rejects Space member directory envelopes that drift from the shared response schema", () => {
      expect(
        cliJsonSpaceMembersEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "space.members",
          ...SPACE_MEMBER_DIRECTORY,
          inventedField: true,
        }).success
      ).toBe(false);
    });

    it("rejects Organization Space list envelopes that drift from the shared directory schema", () => {
      expect(
        cliJsonSpaceListOrganizationEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "space.list.organization",
          ...ORGANIZATION_SPACE_LIST,
          inventedField: true,
        }).success
      ).toBe(false);
      expect(
        cliJsonSpaceListOrganizationEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "space.list.organization",
          ...ORGANIZATION_SPACE_LIST,
          spaces: [
            {
              ...ORGANIZATION_SPACE_LIST.spaces[0],
              activeMemberCount: -1,
            },
          ],
        }).success
      ).toBe(false);
    });

    it("rejects Organization Directory envelopes that drift from the shared response schema", () => {
      expect(
        cliJsonOrganizationDirectoryEnvelopeSchema.safeParse({
          schemaVersion: VERSION,
          type: "organization.directory",
          organizationId: "org-1",
          generatedAt: "2026-07-19T12:00:00.000Z",
          members: [],
          agentProfiles: [],
          inventedField: true,
        }).success
      ).toBe(false);
    });
  });

  describe("entry-check blocked error codes", () => {
    it("accepts each documented blocked code", () => {
      for (const code of [
        "auth.authentication_required",
        "profile.required",
        "local_state.repair_required",
        "upgrade.required",
      ]) {
        expect(
          cliJsonEntryCheckBlockedErrorCodeSchema.safeParse(code).success
        ).toBe(true);
      }
    });

    it("rejects an unknown blocked code", () => {
      expect(
        cliJsonEntryCheckBlockedErrorCodeSchema.safeParse("auth.nope").success
      ).toBe(false);
    });
  });

  it("declares the closed discriminant set in union order", () => {
    expect(CLI_JSON_OUTPUT_TYPES).toEqual([
      "error",
      "daemon.run",
      "daemon.install",
      "daemon.uninstall",
      "daemon.reinstall",
      "daemon.status",
      "daemon.stop",
      "daemon.autostart",
      "agents.detect",
      "agents.list",
      "agents.show",
      "agents.enable",
      "agents.disable",
      "feedback_submitted",
      "projects.list",
      "projects.create",
      "projects.update",
      "projects.archive",
      "projects.bind",
      "projects.unbind",
      "projects.connections.list",
      "projects.connections.set_default",
      "projects.connections.remove",
      "activity.read",
      "activity.install",
      "activity.uninstall",
      "activity.status",
      "activity.health",
      "activity.sync",
      "activity.context",
      "routines.list",
      "routines.create",
      "routines.show",
      "routines.update",
      "routines.pause",
      "routines.resume",
      "routines.delete",
      "routines.runs",
      "space.members",
      "space.list.organization",
      "organization.directory",
      "organization.invite_link.get",
      "organization.invite_link.create",
      "organization.invite_link.revoke",
      "skills.list",
      "skills.show",
      "skills.load",
    ]);
  });
});
