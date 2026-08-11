import { describe, expect, it } from "vitest";
import {
  getDaemonServiceRepairBudgetState,
  recordDaemonServiceRepairFailure,
  recordDaemonServiceRepairSuccess,
} from "../src/local-service/lifecycle/daemon-service-repair-journal";
import { withTempHome } from "./helpers/fs";

describe("local service repair journal", () => {
  it("enters cooldown after repeated failures and resets after a success", async () => {
    await withTempHome(async () => {
      const actions = [
        "prepare_latest_bundle",
        "repair_service_manager_registration",
      ] as const;

      await recordDaemonServiceRepairFailure({
        actions,
        errorMessage: "first failure",
        now: new Date("2026-03-07T00:00:00.000Z"),
      });
      await recordDaemonServiceRepairFailure({
        actions,
        errorMessage: "second failure",
        now: new Date("2026-03-07T00:01:00.000Z"),
      });
      await recordDaemonServiceRepairFailure({
        actions,
        errorMessage: "third failure",
        now: new Date("2026-03-07T00:02:00.000Z"),
      });

      const cooledDownBudget = await getDaemonServiceRepairBudgetState({
        actions,
        now: new Date("2026-03-07T00:02:30.000Z"),
      });
      expect(cooledDownBudget?.status).toBe("cooldown");
      expect(cooledDownBudget?.consecutiveFailures).toBe(3);
      expect(cooledDownBudget?.lastErrorMessage).toBe("third failure");

      await recordDaemonServiceRepairSuccess({
        actions,
        now: new Date("2026-03-07T00:10:00.000Z"),
      });

      const resetBudget = await getDaemonServiceRepairBudgetState({
        actions,
        now: new Date("2026-03-07T00:10:01.000Z"),
      });
      expect(resetBudget?.status).toBe("ready");
      expect(resetBudget?.consecutiveFailures).toBe(0);
      expect(resetBudget?.cooldownUntil).toBeNull();
      expect(resetBudget?.lastErrorMessage).toBeNull();
    });
  });
});
