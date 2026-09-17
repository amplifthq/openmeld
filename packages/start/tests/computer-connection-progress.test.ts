import { describe, expect, it } from "vitest";
import {
  formatComputerConnectionElapsed,
  isNewerComputerConnectionProgress,
  presentComputerConnectionProgress,
} from "../src/presentation/computer-connection-progress";

const base = {
  schemaVersion: 1 as const,
  expectedAccount: "account-b",
  operationId: "operation-a",
  attemptId: "attempt-a",
  prepareSessionId: null,
  sequence: 1,
  startedAt: "2026-09-17T00:00:00.000Z",
  observedAt: "2026-09-17T00:00:00.000Z",
  phase: "checking" as const,
  state: "active" as const,
  code: "desktop.connection.checking",
};

describe("computer connection progress presentation", () => {
  it("uses percentages only for measured transfer bytes", () => {
    expect(presentComputerConnectionProgress(base)).toMatchObject({
      determinate: false,
      percentage: null,
      stage: "Checking this Mac",
    });
    expect(
      presentComputerConnectionProgress({
        ...base,
        phase: "downloading",
        measurement: {
          unit: "bytes",
          value: 25,
          total: 100,
          transferAttempt: 1,
        },
      })
    ).toMatchObject({ determinate: true, percentage: 25 });
  });

  it("rejects stale observations within the active attempt", () => {
    expect(
      isNewerComputerConnectionProgress(
        { ...base, sequence: 4 },
        { ...base, sequence: 3 }
      )
    ).toBe(false);
    expect(
      isNewerComputerConnectionProgress(
        { ...base, sequence: 4 },
        { ...base, sequence: 5 }
      )
    ).toBe(true);
    expect(
      isNewerComputerConnectionProgress(
        { ...base, observedAt: "2026-09-17T00:00:02.000Z" },
        {
          ...base,
          operationId: "operation-old",
          observedAt: "2026-09-17T00:00:01.000Z",
        }
      )
    ).toBe(false);
  });

  it("shows elapsed time only after a noticeable wait", () => {
    expect(
      formatComputerConnectionElapsed(
        "2026-09-17T00:00:00.000Z",
        Date.parse("2026-09-17T00:00:04.000Z")
      )
    ).toBeNull();
    expect(
      formatComputerConnectionElapsed(
        "2026-09-17T00:00:00.000Z",
        Date.parse("2026-09-17T00:01:05.000Z")
      )
    ).toBe("1m 05s");
  });
});
