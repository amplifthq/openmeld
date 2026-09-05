import { describe, expect, it } from "vitest";
import type { RouteCatalog } from "../src/local-service/core/types";
import { createLocalWakeRouteReport } from "../src/local-service/reporting/local-wake-route-report";

const baseCatalog = (): RouteCatalog => ({
  profileIds: [],
  routeByProfileId: new Map(),
  skippedProfiles: [
    {
      profileId: "agt-1",
      profileName: "Agent One",
      skipReason: "workspace.missing",
    },
  ],
  workingFolderObservations: [
    {
      bindingId: "binding-1",
      configurationRevision: 8,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: null,
      observedAtMs: 1_700_000_000_000,
      profileId: "agt-1",
      reasonCode: "project.local_connection.missing",
      source: "default_project",
      status: "missing",
    },
  ],
});

describe("local Wake route report", () => {
  it("sends strict working-folder facts only after v4 negotiation", () => {
    const catalog = baseCatalog();
    catalog.expectedRoutesContractVersion = "v4";
    catalog.workingFolderExpectedProfileIds = ["agt-1"];

    expect(
      createLocalWakeRouteReport({
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "prod",
        reportedAtMs: 1_700_000_001_000,
        routeCatalog: catalog,
        serviceVersion: "0.3.149",
      })
    ).toMatchObject({
      expectedRoutesContractVersion: "v4",
      workingFolderObservations: [
        {
          bindingId: "binding-1",
          configurationRevision: 8,
          defaultProjectId: "project-1",
          localProjectBindingGeneration: null,
          observedAtMs: 1_700_000_000_000,
          profileId: "agt-1",
          reasonCode: "project.local_connection.missing",
          source: "default_project",
          status: "missing",
        },
      ],
    });
  });

  it("keeps the legacy report shape for an older Core", () => {
    const report = createLocalWakeRouteReport({
      daemonSessionId: "session-1",
      deviceId: "device-1",
      lane: "prod",
      reportedAtMs: 1_700_000_001_000,
      routeCatalog: baseCatalog(),
      serviceVersion: "0.3.149",
    });

    expect(report).not.toHaveProperty("expectedRoutesContractVersion");
    expect(report).not.toHaveProperty("workingFolderObservations");
  });

  it("fails closed when v4 facts do not cover the negotiated routes", () => {
    const catalog = baseCatalog();
    catalog.expectedRoutesContractVersion = "v4";
    catalog.workingFolderExpectedProfileIds = ["agt-1", "agt-2"];

    expect(() =>
      createLocalWakeRouteReport({
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "prod",
        reportedAtMs: 1_700_000_001_000,
        routeCatalog: catalog,
        serviceVersion: "0.3.149",
      })
    ).toThrow("do not exactly cover expected routes");
  });
});
