import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesktopUpdaterState } from "@openmeld/schemas";
import {
  desktopUpdateObservationSchema,
  desktopUpdaterStateSchema,
} from "@openmeld/schemas";
import type {
  DaemonServiceLane,
  DesktopUpdateObservation,
  DesktopUpdateObservationResponse,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";

const persistedSchema = z.strictObject({
  installationId: z.string().uuid(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Main-only source observer. Neither Inbox nor renderer owns updater execution. */
export function createDesktopUpdateInboxReporter(input: {
  userData: string;
  lane: DaemonServiceLane;
  deviceName: string;
  platform: "darwin" | "win32" | "linux";
  currentUserId: () => Promise<string | null>;
  send: (
    observation: DesktopUpdateObservation
  ) => Promise<DesktopUpdateObservationResponse>;
}) {
  mkdirSync(input.userData, { recursive: true });
  const path = join(input.userData, "desktop-inbox-installation.json");
  const save = () => {
    const temporary = `${path}.next`;
    writeFileSync(temporary, JSON.stringify(persisted), { mode: 0o600 });
    renameSync(temporary, path);
  };
  let persisted: z.infer<typeof persistedSchema>;
  try {
    persisted = persistedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
    persisted = { installationId: randomUUID(), sequence: 0 };
    save();
  }
  let facts: Pick<
    DesktopUpdateObservation,
    "installedVersion" | "availableVersion"
  > | null = null;
  let revision = 0;
  let disposed = false;
  let work: Promise<void> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  // This suppresses redundant source reports, never notification/read/Dismiss state.
  const delivered = new Map<string, string>();

  function flush(): Promise<void> {
    if (work) {
      return work;
    }
    let processedRevision = revision;
    work = (async () => {
      while (!disposed && facts) {
        const epoch = revision;
        processedRevision = epoch;
        if (!(await processObservation(facts, epoch))) {
          return;
        }
      }
    })()
      .catch((error: unknown) => {
        console.warn("[openmeld.desktop.inbox_update_observation_failed]", {
          error,
        });
        if (!disposed && retry === null) {
          retry = setTimeout(() => {
            retry = null;
            flush();
          }, 15_000);
          retry.unref();
        }
      })
      .finally(() => {
        work = null;
        if (!disposed && revision !== processedRevision) {
          queueMicrotask(() => {
            flush();
          });
        }
      });
    return work;
  }

  async function processObservation(
    snapshot: NonNullable<typeof facts>,
    epoch: number
  ): Promise<boolean> {
    const userId = await input.currentUserId();
    if (disposed) {
      return false;
    }
    if (epoch !== revision) {
      return true;
    }
    if (!userId) {
      return false;
    }
    const fingerprint = JSON.stringify(snapshot);
    if (delivered.get(userId) === fingerprint) {
      return false;
    }
    await deliver(snapshot, userId, fingerprint);
    return epoch !== revision;
  }

  async function deliver(
    snapshot: NonNullable<typeof facts>,
    userId: string,
    fingerprint: string
  ): Promise<void> {
    persisted = { ...persisted, sequence: persisted.sequence + 1 };
    save();
    const observation = desktopUpdateObservationSchema.parse({
      schemaVersion: 1,
      expectedUserId: userId,
      installationId: persisted.installationId,
      sequence: persisted.sequence,
      lane: input.lane,
      deviceName: input.deviceName.slice(0, 100),
      platform: input.platform,
      ...snapshot,
    });
    const response = await input.send(observation);
    if (!response.accepted) {
      persisted = {
        ...persisted,
        sequence: Math.max(persisted.sequence, response.sequence),
      };
      save();
      throw new Error(
        "Desktop update source was superseded; retry its current native facts."
      );
    }
    delivered.set(userId, fingerprint);
  }

  return {
    identity: { installationId: persisted.installationId, lane: input.lane },
    observe(raw: DesktopUpdaterState): Promise<void> {
      const state = desktopUpdaterStateSchema.parse(raw);
      if (state.status === "unavailable") {
        return Promise.resolve();
      }
      if (state.status === "current") {
        facts = {
          installedVersion: state.currentVersion,
          availableVersion: null,
        };
      } else if (
        (state.status === "available" || state.status === "downloaded") &&
        state.version
      ) {
        facts = {
          installedVersion: state.currentVersion,
          availableVersion: state.version,
        };
      } else if (facts) {
        return Promise.resolve();
      } else {
        facts = { installedVersion: state.currentVersion };
      }
      revision += 1;
      return flush();
    },
    accountChanged(): void {
      revision += 1;
      flush();
    },
    dispose(): void {
      disposed = true;
      if (retry !== null) {
        clearTimeout(retry);
      }
    },
  };
}
