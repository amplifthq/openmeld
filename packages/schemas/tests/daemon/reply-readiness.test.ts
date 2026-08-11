import { describe, expect, it } from "vitest";
import {
  REPLY_READINESS_LEVEL_VALUES,
  REPLY_READINESS_REASON_CODE_VALUES,
  replyReadinessLevelSchema,
  replyReadinessReasonCodeSchema,
} from "../../src/index";

describe("reply readiness schemas", () => {
  it("accepts the frozen readiness levels", () => {
    expect(REPLY_READINESS_LEVEL_VALUES).toEqual([
      "blocked",
      "degraded",
      "ready",
      "unknown",
    ]);
    expect(replyReadinessLevelSchema.safeParse("ready").success).toBe(true);
    expect(replyReadinessLevelSchema.safeParse("offline").success).toBe(false);
  });

  it("accepts the frozen readiness reason codes", () => {
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain(
      "controller.bootstrap.failed"
    );
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain(
      "controller.launch.choice_required"
    );
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain("route.offline");
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain(
      "route.not_registered"
    );
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain(
      "local_agents.none_needed"
    );
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain(
      "dispatch.storage_not_ready"
    );
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain("workspace.missing");
    expect(REPLY_READINESS_REASON_CODE_VALUES).toContain("workspace.invalid");
    expect(
      replyReadinessReasonCodeSchema.safeParse(
        "service.gateway_chain_unhealthy"
      ).success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse("dispatch.storage_not_ready")
        .success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse(
        "controller.launch.choice_required"
      ).success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse("workspace.missing").success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse("workspace.invalid").success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse("local_agents.none_needed")
        .success
    ).toBe(true);
    expect(
      replyReadinessReasonCodeSchema.safeParse("space.not_found").success
    ).toBe(false);
  });
});
