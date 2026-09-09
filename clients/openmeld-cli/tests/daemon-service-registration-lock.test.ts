import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bestEffortStopCurrentLaneDaemonService,
  runDaemonTeardownStrict,
} from "../src/commands/service";
import {
  acquireDaemonServiceLifecycleLock,
  readDaemonServiceLifecycleLockMetaWithCleanup,
  releaseDaemonServiceLifecycleLock,
  withDaemonServiceRegistrationMutationLock,
  withDaemonServiceStopLock,
} from "../src/config/daemon-state";
import { withTempHome } from "./helpers/fs";

describe("daemon service registration mutation lock", () => {
  it("allows independent development homes while serializing writers in one home", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_HOME = join(home, "a");
      const a = await acquireDaemonServiceLifecycleLock();
      try {
        await expect(acquireDaemonServiceLifecycleLock()).rejects.toMatchObject(
          { contentionState: "active" }
        );
        process.env.OPENMELD_HOME = join(home, "b");
        const b = await acquireDaemonServiceLifecycleLock();
        await releaseDaemonServiceLifecycleLock(b);
      } finally {
        await releaseDaemonServiceLifecycleLock(a);
      }
    });
  });
  it("serializes registration repair and stop across alternate OPENMELD_HOME roots", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "prod";
      process.env.OPENMELD_HOME = join(home, "isolated-root");
      let stopEntered = false;

      const lifecycleWriter = await acquireDaemonServiceLifecycleLock({
        intent: "stop",
        command: "openmeld service stop",
      });
      try {
        process.env.OPENMELD_HOME = join(home, ".openmeld");
        await expect(
          readDaemonServiceLifecycleLockMetaWithCleanup()
        ).resolves.toMatchObject({
          command: "openmeld service stop",
          intent: "stop",
        });
        await expect(
          withDaemonServiceRegistrationMutationLock(
            () => {
              stopEntered = true;
              return Promise.resolve();
            },
            {
              intent: "upgrade_reconcile",
              command: "OpenMeld Service registration reconcile",
            }
          )
        ).rejects.toMatchObject({
          contentionState: "active",
        });
        expect(stopEntered).toBe(false);
      } finally {
        await releaseDaemonServiceLifecycleLock(lifecycleWriter);
      }

      await withDaemonServiceStopLock(() => {
        stopEntered = true;
        return Promise.resolve();
      });
      expect(stopEntered).toBe(true);
    });
  });

  it("makes strict teardown contend on the preset-owned lifecycle lock across alternate roots", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "prod";
      process.env.OPENMELD_HOME = join(home, "isolated-reset-root");
      const lifecycleWriter = await acquireDaemonServiceLifecycleLock({
        intent: "upgrade_reconcile",
        command: "OpenMeld Service registration reconcile",
      });

      try {
        process.env.OPENMELD_HOME = join(home, "alternate-reset-root");
        await expect(
          runDaemonTeardownStrict({ reason: "reset" })
        ).rejects.toMatchObject({ contentionState: "active" });
      } finally {
        await releaseDaemonServiceLifecycleLock(lifecycleWriter);
      }
    });
  });

  it("makes logout best-effort stop contend on the preset-owned lifecycle lock across alternate roots", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "prod";
      process.env.OPENMELD_HOME = join(home, "isolated-logout-root");
      const lifecycleWriter = await acquireDaemonServiceLifecycleLock({
        intent: "upgrade_reconcile",
        command: "OpenMeld Service registration reconcile",
      });

      try {
        process.env.OPENMELD_HOME = join(home, "alternate-logout-root");
        await expect(
          bestEffortStopCurrentLaneDaemonService({
            runtime: {
              interactive: false,
              resolvedView: "human",
              viewMode: "human",
            },
          })
        ).resolves.toMatchObject({
          errorMessage: expect.stringContaining(
            "OpenMeld Service registration reconcile"
          ),
          reason: "stop_failed",
          status: "warning",
        });
      } finally {
        await releaseDaemonServiceLifecycleLock(lifecycleWriter);
      }
    });
  });

  it("reuses the canonical lock for a nested registration mutation in one lifecycle command", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      let registrationEntered = false;

      await withDaemonServiceStopLock(async () => {
        await withDaemonServiceRegistrationMutationLock(
          () => {
            registrationEntered = true;
            return Promise.resolve();
          },
          {
            intent: "status_cleanup",
            command: "nested registration mutation",
          }
        );
      });

      expect(registrationEntered).toBe(true);
    });
  });

  it("does not let deferred work reuse a lifecycle lock after its owner released it", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      let releaseDeferredMutation: () => void = () => undefined;
      let deferredMutationEntered = false;
      const deferredGate = new Promise<void>((resolve) => {
        releaseDeferredMutation = resolve;
      });
      let deferredMutation: Promise<void> | null = null;

      await withDaemonServiceStopLock(() => {
        deferredMutation = deferredGate.then(async () => {
          await withDaemonServiceRegistrationMutationLock(
            () => {
              deferredMutationEntered = true;
              return Promise.resolve();
            },
            {
              intent: "status_cleanup",
              command: "deferred registration mutation",
            }
          );
        });
        return Promise.resolve();
      });

      const nextWriter = await acquireDaemonServiceLifecycleLock({
        intent: "upgrade_reconcile",
        command: "openmeld service update",
      });
      try {
        releaseDeferredMutation();
        await expect(deferredMutation).rejects.toMatchObject({
          contentionState: "active",
        });
        expect(deferredMutationEntered).toBe(false);
      } finally {
        await releaseDaemonServiceLifecycleLock(nextWriter);
      }
    });
  });

  it("keeps the physical lock until an immediately started nested mutation settles", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      let finishNestedMutation: () => void = () => undefined;
      let reportNestedMutationStarted: () => void = () => undefined;
      const nestedMutationGate = new Promise<void>((resolve) => {
        finishNestedMutation = resolve;
      });
      const nestedMutationStarted = new Promise<void>((resolve) => {
        reportNestedMutationStarted = resolve;
      });
      let nestedMutation: Promise<void> | null = null;
      let nestedMutationFinished = false;

      const firstWriter = withDaemonServiceStopLock(() => {
        nestedMutation = withDaemonServiceRegistrationMutationLock(
          async () => {
            reportNestedMutationStarted();
            await nestedMutationGate;
            nestedMutationFinished = true;
          },
          {
            intent: "status_cleanup",
            command: "nested registration mutation",
          }
        );
        return Promise.resolve();
      });

      await nestedMutationStarted;
      await expect(
        withDaemonServiceRegistrationMutationLock(() => Promise.resolve(), {
          intent: "upgrade_reconcile",
          command: "competing registration mutation",
        })
      ).rejects.toMatchObject({ contentionState: "active" });

      finishNestedMutation();
      await firstWriter;
      await nestedMutation;
      expect(nestedMutationFinished).toBe(true);
    });
  });

  it("reports detached nested failures through the owner without an unhandled rejection", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      const nestedFailure = new Error("nested registration mutation failed");
      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
      };
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        const ownerOperation = withDaemonServiceStopLock(() => {
          const detachedOperation = withDaemonServiceRegistrationMutationLock(
            () => Promise.reject(nestedFailure),
            {
              intent: "status_cleanup",
              command: "detached registration mutation",
            }
          );
          expect(detachedOperation).toBeInstanceOf(Promise);
          return Promise.resolve();
        });

        await expect(ownerOperation).rejects.toBe(nestedFailure);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }
    });
  });
});
