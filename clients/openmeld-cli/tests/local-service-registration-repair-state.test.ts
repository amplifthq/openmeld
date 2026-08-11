import { describe, expect, it } from "vitest";
import {
  clearDaemonServiceRegistrationRepairPending,
  markDaemonServiceRegistrationRepairPending,
  readDaemonServiceRegistrationRepairState,
} from "../src/local-service/lifecycle/daemon-service-registration-repair-state";
import { withTempHome } from "./helpers/fs";

describe("service registration repair state", () => {
  it("persists a pending repair across reconcile passes and clears it explicitly", async () => {
    await withTempHome(async (home) => {
      await expect(
        readDaemonServiceRegistrationRepairState()
      ).resolves.toBeNull();

      process.env.OPENMELD_HOME = `${home}/isolated-root`;
      process.env.OPENMELD_ENV_PRESET = "prod";
      await markDaemonServiceRegistrationRepairPending("launchd");

      process.env.OPENMELD_HOME = `${home}/.openmeld`;
      await expect(
        readDaemonServiceRegistrationRepairState()
      ).resolves.toMatchObject({
        controller: "launchd",
        pendingSince: expect.any(String),
      });

      await clearDaemonServiceRegistrationRepairPending();

      await expect(
        readDaemonServiceRegistrationRepairState()
      ).resolves.toBeNull();
    });
  });
});
