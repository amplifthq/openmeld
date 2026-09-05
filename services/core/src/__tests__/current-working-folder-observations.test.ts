import type {
  LocalWakeRouteReport,
  LocalWakeRouteWorkingFolderObservation,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type CurrentExpectedWorkingFolderRoute,
  resolveCurrentWorkingFolderObservations,
} from "../agent-profile-binding/application/current-working-folder-observations";

const NOW_MS = 1_700_000_030_000;
const CURRENT_SESSION = {
  daemonSessionId: "session-2",
  deviceId: "device-1",
  lane: "prod" as const,
};
const EXPECTED_ROUTES: CurrentExpectedWorkingFolderRoute[] = [
  {
    agentProfileId: "agent-1",
    bindingId: "binding-1",
    configurationRevision: 3,
    defaultProjectId: "project-1",
  },
  {
    agentProfileId: "agent-2",
    bindingId: "binding-2",
    configurationRevision: 5,
    defaultProjectId: null,
  },
];
const DEFAULT_PROJECT_OBSERVATION: LocalWakeRouteWorkingFolderObservation = {
  bindingId: "binding-1",
  configurationRevision: 3,
  defaultProjectId: "project-1",
  localProjectBindingGeneration: "binding-generation-7",
  observedAtMs: NOW_MS - 1000,
  profileId: "agent-1",
  reasonCode: null,
  source: "default_project",
  status: "ready",
};
const PROFILE_WORKSPACE_OBSERVATION: LocalWakeRouteWorkingFolderObservation = {
  bindingId: "binding-2",
  configurationRevision: 5,
  defaultProjectId: null,
  localProjectBindingGeneration: null,
  observedAtMs: NOW_MS - 1000,
  profileId: "agent-2",
  reasonCode: "profile.workspace.missing",
  source: "profile_workspace",
  status: "missing",
};
const OBSERVATIONS: LocalWakeRouteWorkingFolderObservation[] = [
  DEFAULT_PROJECT_OBSERVATION,
  PROFILE_WORKSPACE_OBSERVATION,
];

function createV4Report(
  overrides: Partial<
    Extract<LocalWakeRouteReport, { expectedRoutesContractVersion: "v4" }>
  > = {}
): Extract<LocalWakeRouteReport, { expectedRoutesContractVersion: "v4" }> {
  return {
    ...CURRENT_SESSION,
    expectedRoutesContractVersion: "v4",
    includedProfileIds: ["agent-1", "agent-2"],
    reportedAtMs: NOW_MS,
    skippedProfiles: [],
    workingFolderObservations: OBSERVATIONS,
    ...overrides,
  };
}

function resolve(
  overrides: Partial<
    Parameters<typeof resolveCurrentWorkingFolderObservations>[0]
  > = {}
) {
  return resolveCurrentWorkingFolderObservations({
    currentSession: CURRENT_SESSION,
    expectedRoutes: EXPECTED_ROUTES,
    freshnessMs: 90_000,
    nowMs: NOW_MS,
    report: createV4Report(),
    ...overrides,
  });
}

describe("current working-folder observation consumer", () => {
  it("confirms complete fresh v4 facts against the current Core expected set", () => {
    const result = resolve();

    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") {
      expect(result.observationsByProfileId.get("agent-2")).toMatchObject({
        reasonCode: "profile.workspace.missing",
        status: "missing",
      });
    }
  });

  it("re-evaluates an opaque local Project generation from each accepted report", () => {
    const replacementGeneration = resolve({
      report: createV4Report({
        workingFolderObservations: [
          {
            ...DEFAULT_PROJECT_OBSERVATION,
            localProjectBindingGeneration: "binding-generation-8",
          },
          PROFILE_WORKSPACE_OBSERVATION,
        ],
      }),
    });

    expect(replacementGeneration.status).toBe("confirmed");
    if (replacementGeneration.status === "confirmed") {
      expect(
        replacementGeneration.observationsByProfileId.get("agent-1")
          ?.localProjectBindingGeneration
      ).toBe("binding-generation-8");
    }
  });

  it.each([
    ["missing", [OBSERVATIONS[0]]],
    ["duplicate", [OBSERVATIONS[0], OBSERVATIONS[0]]],
    [
      "extra",
      [
        ...OBSERVATIONS,
        { ...OBSERVATIONS[1], bindingId: "binding-3", profileId: "agent-3" },
      ],
    ],
  ])("rejects %s observation coverage without partial truth", (_label, observations) => {
    expect(
      resolve({
        report: createV4Report({
          workingFolderObservations:
            observations as LocalWakeRouteWorkingFolderObservation[],
        }),
      })
    ).toEqual({
      reasonCode: "working_folder.observation_coverage_invalid",
      status: "unknown",
    });
  });

  it.each([
    ["bindingId", { bindingId: "old-binding" }],
    ["configurationRevision", { configurationRevision: 2 }],
    ["defaultProjectId", { defaultProjectId: "old-project" }],
  ])("rejects a stale %s identity echo", (_label, identity) => {
    expect(
      resolve({
        report: createV4Report({
          workingFolderObservations: [
            {
              ...DEFAULT_PROJECT_OBSERVATION,
              ...identity,
            } as LocalWakeRouteWorkingFolderObservation,
            PROFILE_WORKSPACE_OBSERVATION,
          ],
        }),
      })
    ).toEqual({
      reasonCode: "working_folder.observation_identity_mismatch",
      status: "unknown",
    });
  });

  it("rejects an old Service report and never upgrades it from history", () => {
    const legacyReport: LocalWakeRouteReport = {
      ...CURRENT_SESSION,
      includedProfileIds: ["agent-1", "agent-2"],
      reportedAtMs: NOW_MS,
      skippedProfiles: [],
    };

    expect(resolve({ report: legacyReport })).toEqual({
      reasonCode: "working_folder.legacy_contract",
      status: "unknown",
    });
  });

  it.each([
    ["daemonSessionId", { daemonSessionId: "session-1" }],
    ["deviceId", { deviceId: "device-2" }],
    ["lane", { lane: "canary" as const }],
  ])("rejects a non-current %s", (_label, sessionIdentity) => {
    expect(resolve({ report: createV4Report(sessionIdentity) })).toEqual({
      reasonCode: "working_folder.session_mismatch",
      status: "unknown",
    });
  });

  it("rejects expired report and observation freshness", () => {
    expect(
      resolve({ report: createV4Report({ reportedAtMs: NOW_MS - 90_000 }) })
    ).toEqual({
      reasonCode: "working_folder.report_stale",
      status: "unknown",
    });
    expect(
      resolve({
        report: createV4Report({
          workingFolderObservations: [
            {
              ...DEFAULT_PROJECT_OBSERVATION,
              observedAtMs: NOW_MS - 90_000,
            } as LocalWakeRouteWorkingFolderObservation,
            PROFILE_WORKSPACE_OBSERVATION,
          ],
        }),
      })
    ).toEqual({
      reasonCode: "working_folder.observation_stale",
      status: "unknown",
    });
  });
});
