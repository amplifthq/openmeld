import { describe, expect, it } from "vitest";
import {
  classifyHarnessReportDetection,
  HARNESS_MISSING_AFTER_MS,
  isHarnessPresentOnRuntime,
} from "../../member-agent/application/harness-presence-policy";
import { NOW_MS, presentFact } from "./member-agent-test-fixtures";

describe("classifyHarnessReportDetection", () => {
  it("reads only a not-detected report as undetected", () => {
    expect(
      classifyHarnessReportDetection({
        reasonCodes: ["local_agent_preparation.not_detected"],
        status: "unavailable",
      })
    ).toBe("undetected");
  });

  it("keeps an installed but unsupported Harness neutral", () => {
    expect(
      classifyHarnessReportDetection({
        reasonCodes: ["local_agent_preparation.not_supported_yet"],
        status: "unavailable",
      })
    ).toBe("unknown");
  });

  it("keeps a turned-off controller neutral", () => {
    expect(
      classifyHarnessReportDetection({ reasonCodes: [], status: "disabled" })
    ).toBe("unknown");
    expect(
      classifyHarnessReportDetection({
        reasonCodes: ["local_agent_preparation.not_enabled"],
        status: "unavailable",
      })
    ).toBe("unknown");
  });

  it("reads an installed but signed-out Harness as detected", () => {
    expect(
      classifyHarnessReportDetection({
        reasonCodes: ["controller.auth.unauthenticated"],
        status: "unavailable",
      })
    ).toBe("detected");
  });
});

describe("isHarnessPresentOnRuntime debounce", () => {
  const firstMiss = NOW_MS - 30_000;

  it("keeps a Harness present across one missing report, however long ago", () => {
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: presentFact({
          firstUndetectedAtMs: NOW_MS - 2 * HARNESS_MISSING_AFTER_MS,
          undetectedReportCount: 1,
        }),
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it("keeps two recent misses present and settles them after five minutes", () => {
    const twoMisses = presentFact({
      firstUndetectedAtMs: firstMiss,
      undetectedReportCount: 2,
    });
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: twoMisses,
        nowMs: NOW_MS,
      })
    ).toBe(true);
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: twoMisses,
        nowMs: firstMiss + HARNESS_MISSING_AFTER_MS,
      })
    ).toBe(false);
  });

  it("reads three consecutive misses as absent", () => {
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: presentFact({
          firstUndetectedAtMs: firstMiss,
          undetectedReportCount: 3,
        }),
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });

  it("lets a current detection win over a stale fact", () => {
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "detected",
        fact: presentFact({
          firstUndetectedAtMs: firstMiss,
          undetectedReportCount: 3,
        }),
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it("keeps a Harness without history through a first miss or a turned-off report", () => {
    for (const currentDetection of ["undetected", "unknown"] as const) {
      expect(
        isHarnessPresentOnRuntime({
          currentDetection,
          fact: null,
          nowMs: NOW_MS,
        })
      ).toBe(true);
    }
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: presentFact({
          firstUndetectedAtMs: firstMiss,
          lastDetectedAtMs: null,
          undetectedReportCount: 1,
        }),
        nowMs: NOW_MS,
      })
    ).toBe(true);
  });

  it("drops a computer that never had the Harness after three misses", () => {
    expect(
      isHarnessPresentOnRuntime({
        currentDetection: "undetected",
        fact: presentFact({
          firstUndetectedAtMs: firstMiss,
          lastDetectedAtMs: null,
          undetectedReportCount: 3,
        }),
        nowMs: NOW_MS,
      })
    ).toBe(false);
  });
});
