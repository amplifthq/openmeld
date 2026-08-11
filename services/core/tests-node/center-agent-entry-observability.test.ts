import {
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createCenterAgentDirectMessageOpenTiming } from "../src/center-agent/application/center-agent-dm-open-observability";
import type { CoreBindings } from "../src/lib/bindings";
import { measureSpaceSchemaInitialization } from "../src/space/application/space-schema-observability";

type AnalyticsPoint = {
  blobs: string[];
  doubles: number[];
  indexes: string[];
};

describe("Center Agent entry observability", () => {
  it("records DM-open stages and distinguishes an existing Space", async () => {
    const writeDataPoint = vi.fn();
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const times = [0, 5, 12, 15, 20, 30];
    const timing = createCenterAgentDirectMessageOpenTiming({
      env: {
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      } as unknown as CoreBindings,
      nowMs: () => times.shift() ?? 30,
      requestId: "req-center-agent-entry",
    });

    try {
      await expect(
        timing.measure("membership", async () => "member")
      ).resolves.toBe("member");
      expect(timing.measureSync("human_member", () => "human")).toBe("human");

      timing.emit({
        centerAgentProfileId: "agent-center",
        created: false,
        spaceId: "space-1",
      });

      const points = writeDataPoint.mock.calls.map(
        (call) => call[0] as AnalyticsPoint
      );
      expect(points.map((point) => readBlob(point, "reasonCode"))).toEqual([
        "membership",
        "human_member",
        "total_existing",
      ]);
      expect(points.map((point) => readDouble(point, "durationMs"))).toEqual([
        7, 5, 30,
      ]);
      expect(
        points.every(
          (point) => readBlob(point, "requestId") === "req-center-agent-entry"
        )
      ).toBe(true);
      expect(
        points.every((point) => readBlob(point, "spaceId") === "space-1")
      ).toBe(true);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("measures Space schema initialization without changing its return or failure", () => {
    const writeDataPoint = vi.fn();
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const env = {
      OPENMELD_OBSERVABILITY: { writeDataPoint },
      OPENMELD_WORKER_ENVIRONMENT: "test",
    } as unknown as CoreBindings;

    try {
      expect(
        measureSpaceSchemaInitialization({
          env,
          initialize: () => "ready",
          nowMs: (() => {
            const times = [10, 27];
            return () => times.shift() ?? 27;
          })(),
          spaceId: "space-1",
        })
      ).toBe("ready");

      const successPoint = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
      expect(readBlob(successPoint, "reasonCode")).toBe(
        "ensure_space_sql_schema"
      );
      expect(readBlob(successPoint, "status")).toBe("succeeded");
      expect(readBlob(successPoint, "spaceId")).toBe("space-1");
      expect(readDouble(successPoint, "durationMs")).toBe(17);

      const failure = new Error("schema failed");
      expect(() =>
        measureSpaceSchemaInitialization({
          env,
          initialize: () => {
            throw failure;
          },
          nowMs: (() => {
            const times = [30, 41];
            return () => times.shift() ?? 41;
          })(),
          spaceId: "space-1",
        })
      ).toThrow(failure);

      const failurePoint = writeDataPoint.mock.calls[1]?.[0] as AnalyticsPoint;
      expect(readBlob(failurePoint, "status")).toBe("failed");
      expect(readDouble(failurePoint, "durationMs")).toBe(11);
      expect(consoleInfo.mock.calls[1]?.[0]).toMatchObject({
        errorName: "Error",
        status: "failed",
      });
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

function readBlob(
  point: AnalyticsPoint,
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): string {
  return (
    point.blobs[OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key)] ?? ""
  );
}

function readDouble(
  point: AnalyticsPoint,
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES)[number]
): number {
  return (
    point.doubles[OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.indexOf(key)] ?? 0
  );
}
