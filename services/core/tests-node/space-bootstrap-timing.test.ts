import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createSpaceBootstrapTimingCollector,
  formatSpaceBootstrapServerTiming,
} from "../src/space/application/space-bootstrap-timing";
import { readSpaceStatusSummaryFromMembersSnapshotUseCase } from "../src/space/application/space-status-service";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";

describe("space bootstrap server timing", () => {
  it("formats stable Server-Timing metrics with total first", () => {
    const header = formatSpaceBootstrapServerTiming([
      {
        name: "openmeld_bootstrap_threads",
        description: "Threads branch",
        durationMs: 3.24,
      },
      {
        name: "openmeld_bootstrap_total",
        description: 'OpenMeld "bootstrap" total',
        durationMs: 12.26,
      },
      {
        name: "openmeld_bootstrap_status_members_records",
        description: "Status members summary: load member records",
        durationMs: 5,
      },
    ]);

    expect(header).toBe(
      'openmeld_bootstrap_total;dur=12.3;desc="OpenMeld \\"bootstrap\\" total", openmeld_bootstrap_status_members_records;dur=5;desc="Status members summary: load member records", openmeld_bootstrap_threads;dur=3.2;desc="Threads branch"'
    );
  });

  it("records async and sync measurements", async () => {
    const times = [10, 15, 20, 27];
    const collector = createSpaceBootstrapTimingCollector({
      nowMs: () => times.shift() ?? 27,
    });

    const syncValue = collector.measureSync(
      {
        name: "openmeld_bootstrap_members_records",
        description: "Members branch: load member records",
      },
      () => "records"
    );
    const asyncValue = await collector.measure(
      {
        name: "openmeld_bootstrap_history_recent_signals",
        description: "History branch: load recent signals",
      },
      async () => "signals"
    );

    expect(syncValue).toBe("records");
    expect(asyncValue).toBe("signals");
    expect(collector.metrics()).toEqual([
      {
        name: "openmeld_bootstrap_members_records",
        description: "Members branch: load member records",
        durationMs: 5,
      },
      {
        name: "openmeld_bootstrap_history_recent_signals",
        description: "History branch: load recent signals",
        durationMs: 7,
      },
    ]);
  });

  it("records bootstrap status summary derivation without rebuilding agent snapshots", async () => {
    const times = [100, 101, 102, 103, 104, 105];
    const collector = createSpaceBootstrapTimingCollector({
      nowMs: () => times.shift() ?? 105,
    });
    const sql = {
      exec: () => ({
        toArray: () => [],
      }),
    } as unknown as SqlStorage;
    const membersSnapshot: SpaceMembersSnapshot = {
      spaceId: "space_bootstrap_timing",
      generatedAt: "2026-07-01T00:00:00.000Z",
      summary: {
        totalCount: 0,
        humanCount: 0,
        agentCount: 0,
        liveNowCount: 0,
        wakeableAgentCount: 0,
        checkingAgentCount: 0,
        offlineAgentCount: 0,
        unavailableAgentCount: 0,
      },
      humans: [],
      agents: [],
    };

    const response = await readSpaceStatusSummaryFromMembersSnapshotUseCase({
      sql,
      env: {} as CoreBindings,
      spaceId: membersSnapshot.spaceId,
      metaRecord: {
        spaceId: membersSnapshot.spaceId,
        organizationId: "org-1",
        visibility: "private",
        name: "Bootstrap Timing",
        accessMode: "public",
      } as SpaceMetaRecord,
      membersSnapshot,
      contractStore: {
        readSpaceContract: () => null,
      },
      timing: {
        collector,
        descriptionPrefix: "Status branch",
        metricPrefix: "openmeld_bootstrap_status",
      },
    });

    expect(response.members).toEqual({
      ...membersSnapshot.summary,
      liveHumanCount: 0,
      liveAgentCount: 0,
    });
    expect(collector.metrics().map((metric) => metric.name)).toEqual([
      "openmeld_bootstrap_status_contract",
      "openmeld_bootstrap_status_members_summary",
      "openmeld_bootstrap_status_latest_visible_update",
    ]);
    expect(
      collector
        .metrics()
        .some((metric) =>
          metric.name.startsWith("openmeld_bootstrap_status_members_agent")
        )
    ).toBe(false);
  });
});
