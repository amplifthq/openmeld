import { describe, expect, it } from "vitest";
import {
  localProjectControlConnectCandidateDaemonRequestSchema,
  localProjectControlConnectCandidateRequestSchema,
  localProjectControlConnectDeclaredPathDaemonRequestSchema,
  localProjectControlConnectDeclaredPathRequestSchema,
  localProjectControlConnectOutcomeSchema,
  localProjectControlConnectResponseSchema,
  localProjectControlDaemonFrameSchema,
  localProjectControlDiscoverProjectsDaemonRequestSchema,
  localProjectControlDiscoverProjectsRequestSchema,
  localProjectControlDiscoverProjectsResponseSchema,
  localProjectControlErrorCodeSchema,
  localProjectControlErrorResponseSchema,
  localProjectControlRemoveConnectionRequestSchema,
  localProjectControlRemoveConnectionResponseSchema,
  localProjectControlRemoveMissingConnectionsRequestSchema,
  localProjectControlRemoveMissingConnectionsResponseSchema,
  localProjectControlSetDefaultConnectionRequestSchema,
  localProjectControlSetDefaultConnectionResponseSchema,
  runtimeTransportCapabilitiesSchema,
} from "../../src";

const FINGERPRINT =
  "sha256:504348ce28faa64ec08482e9139c257e5fb68ff1790c9e5a01e9fd9b3a400136";
const AVAILABLE_CONNECTION = {
  bindingGeneration: "binding-1",
  isDefault: true,
  path: "/Users/felix/work/openmeld",
  status: "available" as const,
};

describe("local Project control contracts", () => {
  it("advertises Project operations as a sibling current-device capability", () => {
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        localProjectControl: {
          connectCandidate: true,
          connectDeclaredPath: true,
          discoverProjects: true,
          moveConnection: true,
          removeConnection: true,
          removeMissingConnections: true,
          setDefaultConnection: true,
        },
      })
    ).toMatchObject({ success: true });
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        localAgentControl: { discoverProjects: true },
      })
    ).toMatchObject({ success: false });
  });

  it("separates caller input from Core-authored canonical Project facts", () => {
    expect(
      localProjectControlDiscoverProjectsDaemonRequestSchema.safeParse({
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        projects: [
          { projectId: "project-1", repositoryFingerprint: FINGERPRINT },
          { projectId: "project-2", repositoryFingerprint: null },
        ],
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlDiscoverProjectsDaemonRequestSchema.safeParse({
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        projects: [
          {
            projectId: "project-1",
            projectSlug: "caller-must-not-author-this-field",
            repositoryFingerprint: FINGERPRINT,
          },
        ],
      })
    ).toMatchObject({ success: false });
  });

  it("keeps discover requests strict and Organization-scoped", () => {
    expect(
      localProjectControlDiscoverProjectsRequestSchema.safeParse({
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        projectIds: ["project-1"],
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlDiscoverProjectsRequestSchema.safeParse({
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        repositoryFingerprint: FINGERPRINT,
      })
    ).toMatchObject({ success: false });
  });

  it.each([
    {
      candidates: [],
      connections: [AVAILABLE_CONNECTION],
      projectId: "project-connected",
      status: "connected",
    },
    {
      candidates: [],
      connections: [
        { ...AVAILABLE_CONNECTION, path: "/missing", status: "missing" },
        {
          ...AVAILABLE_CONNECTION,
          bindingGeneration: "binding-2",
          isDefault: false,
        },
      ],
      projectId: "project-missing",
      status: "connected_folder_missing",
    },
    {
      candidates: [
        {
          candidateId: "candidate-1",
          candidateKind: "worktree",
          canonicalPath: "/Users/felix/work/openmeld-feature",
          repositoryFingerprint: FINGERPRINT,
        },
      ],
      connections: [],
      projectId: "project-found",
      status: "found",
    },
    {
      candidates: [],
      connections: [],
      projectId: "project-not-found",
      status: "not_found",
    },
    {
      candidates: [],
      connections: [],
      projectId: "project-unverified",
      status: "verification_unavailable",
    },
  ])("accepts the $status discovery result", (project) => {
    expect(
      localProjectControlDiscoverProjectsResponseSchema.safeParse({
        checkedAtMs: 1_783_892_400_000,
        clientGeneration: 4,
        deviceId: "device-1",
        gitStatus: "available",
        projects: [project],
        requestId: "request-1",
      })
    ).toMatchObject({ success: true });
  });

  it("requires the Project-level missing status when the default folder is missing", () => {
    expect(
      localProjectControlDiscoverProjectsResponseSchema.safeParse({
        checkedAtMs: 1,
        clientGeneration: 1,
        deviceId: "device-1",
        gitStatus: "available",
        projects: [
          {
            candidates: [],
            connections: [
              { ...AVAILABLE_CONNECTION, path: "/missing", status: "missing" },
            ],
            projectId: "project-1",
            status: "connected",
          },
        ],
        requestId: "request-1",
      })
    ).toMatchObject({ success: false });
  });

  it("freezes candidate and declared-path connect requests separately", () => {
    expect(
      localProjectControlConnectCandidateRequestSchema.safeParse({
        candidateId: "candidate-1",
        candidatePath: "/Users/felix/work/openmeld",
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-1",
        moveConfirmationToken: "move-confirmation-1",
        projectId: "project-1",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlConnectDeclaredPathRequestSchema.safeParse({
        confirmNonGit: true,
        clientGeneration: 4,
        declaredPath: "/Users/felix/work/openmeld",
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-2",
        moveConfirmationToken: "move-confirmation-2",
        projectId: "project-1",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlConnectCandidateRequestSchema.safeParse({
        candidateId: "candidate-1",
        candidatePath: "/Users/felix/work/openmeld",
        clientGeneration: 4,
        declaredPath: "/tmp/wrong",
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-1",
        projectId: "project-1",
      })
    ).toMatchObject({ success: false });
    expect(
      localProjectControlConnectDeclaredPathRequestSchema.safeParse({
        clientGeneration: 4,
        declaredPath: "relative/repository",
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-relative",
        projectId: "project-1",
      })
    ).toMatchObject({ success: false });
  });

  it("requires Core-authored fingerprint and slug facts on daemon connect requests", () => {
    const base = {
      clientGeneration: 4,
      expectedOrganizationId: "org-1",
      idempotencyKey: "connect-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: FINGERPRINT,
    };
    expect(
      localProjectControlConnectCandidateDaemonRequestSchema.safeParse({
        ...base,
        candidateId: "candidate-1",
        candidatePath: "/Users/felix/work/openmeld",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlConnectDeclaredPathDaemonRequestSchema.safeParse({
        ...base,
        confirmNonGit: true,
        declaredPath: "/Users/felix/work/openmeld",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlConnectCandidateDaemonRequestSchema.safeParse({
        candidateId: "candidate-1",
        candidatePath: "/Users/felix/work/openmeld",
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        idempotencyKey: "connect-1",
        projectId: "project-1",
      })
    ).toMatchObject({ success: false });
  });

  it("returns the canonical connection identity and rejects unknown fields", () => {
    const response = {
      bindingGeneration: "binding-1",
      canonicalPath: "/Users/felix/work/openmeld",
      isDefault: true,
      status: "connected",
    };
    expect(
      localProjectControlConnectResponseSchema.safeParse(response)
    ).toMatchObject({ success: true });
    expect(
      localProjectControlConnectResponseSchema.safeParse({
        ...response,
        repositoryPath: response.canonicalPath,
      })
    ).toMatchObject({ success: false });
  });

  it("freezes the three connection mutation requests and snapshots", () => {
    const common = {
      clientGeneration: 4,
      expectedOrganizationId: "org-1",
      idempotencyKey: "mutation-1",
      projectId: "project-1",
    };
    expect(
      localProjectControlSetDefaultConnectionRequestSchema.safeParse({
        ...common,
        targetBindingGeneration: "binding-2",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlSetDefaultConnectionResponseSchema.safeParse({
        connections: [AVAILABLE_CONNECTION],
        status: "updated",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlRemoveConnectionRequestSchema.safeParse({
        ...common,
        bindingGeneration: "binding-1",
        replacementBindingGeneration: "binding-2",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlRemoveConnectionResponseSchema.safeParse({
        connections: [],
        status: "removed",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlRemoveMissingConnectionsRequestSchema.safeParse(common)
    ).toMatchObject({ success: true });
    expect(
      localProjectControlRemoveMissingConnectionsResponseSchema.safeParse({
        connections: [AVAILABLE_CONNECTION],
        removedCount: 2,
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlRemoveConnectionRequestSchema.safeParse({
        ...common,
        bindingGeneration: "binding-1",
        replacementBindingGeneration: "binding-2",
        replacementPath: "/tmp/not-part-of-the-contract",
      })
    ).toMatchObject({ success: false });
  });

  it.each([
    "path_not_found",
    "path_not_directory",
    "path_unreadable",
    "path_conflict",
    "fingerprint_mismatch",
    "needs_confirmation",
    "git_unavailable",
    "command_line_tools_missing",
    "service_offline",
    "timeout",
  ])("freezes the %s local Project control error code", (code) => {
    expect(localProjectControlErrorCodeSchema.safeParse(code)).toMatchObject({
      success: true,
    });
  });

  it("keeps conflict diagnostics useful without leaking another Organization name", () => {
    expect(
      localProjectControlErrorResponseSchema.safeParse({
        code: "path_conflict",
        conflictingProjectSlug: "other-project",
        conflictScope: "another_organization",
        message:
          "This folder is already connected to the “other-project” Project in another Organization.",
        moveConfirmationToken: "move-confirmation-1",
        moveImpact: "only_connection",
        status: "rejected",
      })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlErrorResponseSchema.safeParse({
        code: "path_conflict",
        conflictingOrganizationName: "Secret Workspace",
        conflictingProjectSlug: "other-project",
        message: "Conflict",
        status: "rejected",
      })
    ).toMatchObject({ success: false });
    expect(
      localProjectControlConnectOutcomeSchema.safeParse({
        code: "path_conflict",
        conflictingProjectSlug: "other-project",
        conflictScope: "another_organization",
        message:
          "This folder is already connected to the “other-project” Project in another Organization.",
        moveConfirmationToken: "move-confirmation-1",
        moveImpact: "only_connection",
        status: "rejected",
      })
    ).toMatchObject({ success: true });
  });

  it.each([
    [
      "daemon.local_project_control.discover_projects",
      {
        requestId: "request-1",
        request: {
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          projects: [
            { projectId: "project-1", repositoryFingerprint: FINGERPRINT },
          ],
        },
      },
    ],
    [
      "daemon.local_project_control.connect_candidate",
      {
        requestId: "request-2",
        request: {
          candidateId: "candidate-1",
          candidatePath: "/Users/felix/work/openmeld",
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          idempotencyKey: "connect-1",
          projectId: "project-1",
          projectSlug: "openmeld",
          repositoryFingerprint: FINGERPRINT,
        },
      },
    ],
    [
      "daemon.local_project_control.connect_declared_path",
      {
        requestId: "request-3",
        request: {
          clientGeneration: 4,
          confirmNonGit: true,
          declaredPath: "/Users/felix/work/openmeld",
          expectedOrganizationId: "org-1",
          idempotencyKey: "connect-2",
          projectId: "project-1",
          projectSlug: "openmeld",
          repositoryFingerprint: null,
        },
      },
    ],
    [
      "daemon.local_project_control.set_default_connection",
      {
        requestId: "request-4",
        request: {
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          idempotencyKey: "default-1",
          projectId: "project-1",
          targetBindingGeneration: "binding-2",
        },
      },
    ],
    [
      "daemon.local_project_control.remove_connection",
      {
        requestId: "request-5",
        request: {
          bindingGeneration: "binding-1",
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          idempotencyKey: "remove-1",
          projectId: "project-1",
        },
      },
    ],
    [
      "daemon.local_project_control.remove_missing_connections",
      {
        requestId: "request-6",
        request: {
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          idempotencyKey: "remove-missing-1",
          projectId: "project-1",
        },
      },
    ],
  ])("round-trips the %s request frame", (code, payload) => {
    expect(
      localProjectControlDaemonFrameSchema.safeParse({ code, payload, v: 1 })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlDaemonFrameSchema.safeParse({
        code,
        payload: { ...payload, unexpected: true },
        v: 1,
      })
    ).toMatchObject({ success: false });
  });

  it.each([
    [
      "daemon.local_project_control.discover_projects_result",
      {
        requestId: "request-1",
        result: {
          checkedAtMs: 123,
          clientGeneration: 4,
          deviceId: "device-1",
          gitStatus: "available",
          projects: [],
          requestId: "request-1",
        },
      },
    ],
    [
      "daemon.local_project_control.connect_candidate_result",
      {
        requestId: "request-2",
        result: {
          bindingGeneration: "binding-1",
          canonicalPath: "/Users/felix/work/openmeld",
          isDefault: true,
          status: "connected",
        },
      },
    ],
    [
      "daemon.local_project_control.connect_declared_path_result",
      {
        requestId: "request-3",
        result: {
          bindingGeneration: "binding-1",
          canonicalPath: "/Users/felix/work/openmeld",
          isDefault: true,
          status: "unchanged",
        },
      },
    ],
    [
      "daemon.local_project_control.set_default_connection_result",
      {
        requestId: "request-4",
        result: { connections: [AVAILABLE_CONNECTION], status: "updated" },
      },
    ],
    [
      "daemon.local_project_control.remove_connection_result",
      {
        requestId: "request-5",
        result: { connections: [], status: "removed" },
      },
    ],
    [
      "daemon.local_project_control.remove_missing_connections_result",
      {
        requestId: "request-6",
        result: { connections: [], removedCount: 1 },
      },
    ],
  ])("round-trips the %s result frame", (code, payload) => {
    expect(
      localProjectControlDaemonFrameSchema.safeParse({ code, payload, v: 1 })
    ).toMatchObject({ success: true });
    expect(
      localProjectControlDaemonFrameSchema.safeParse({
        code,
        payload: { ...payload, unexpected: true },
        v: 1,
      })
    ).toMatchObject({ success: false });
  });
});
