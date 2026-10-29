import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { computerPowerRequestSchema } from "@openmeld/schemas";
import type {
  ComputerPowerRequest,
  ComputerPowerState,
} from "@openmeld/schemas/types";
import {
  acquireIdleSleepPrevention,
  supportsIdleSleepPrevention,
} from "./idle-sleep";

// This owner lives in the execution host, across cloud reconnects and Desktop exit.
export function createComputerPower(input: {
  path: string;
  supported?: boolean;
  acquire?: typeof acquireIdleSleepPrevention;
}) {
  const supported = input.supported ?? supportsIdleSleepPrevention();
  let enabled = false;
  let revision = 0;
  let activeTasks = 0;
  let stopped = false;
  let problem: string | null = null;
  let loadError: Error | null = null;
  let release: (() => Promise<void>) | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => T | Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => undefined);
    return next;
  };
  const ready = serial(async () => {
    try {
      const saved = JSON.parse(await readFile(input.path, "utf8"));
      const parsed = computerPowerRequestSchema.parse({
        operation: "update",
        enabled: saved.enabled,
        expectedRevision: saved.revision,
      });
      if (parsed.operation === "update") {
        enabled = parsed.enabled;
        revision = parsed.expectedRevision;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        enabled = true;
      } else {
        loadError = new Error(
          "Could not read sleep prevention settings. Update or repair OpenMeld Service."
        );
      }
    }
  });
  const state = (): ComputerPowerState => ({
    enabled,
    revision,
    active: release !== null,
    supported,
    problem,
  });
  async function reconcile() {
    const wanted = !stopped && supported && enabled && activeTasks > 0;
    if (!wanted && release) {
      const stop = release;
      release = null;
      await stop();
    }
    if (wanted && !release && !problem) {
      try {
        release = await (input.acquire ?? acquireIdleSleepPrevention)(
          (message) => {
            release = null;
            problem = message;
          }
        );
      } catch (error) {
        problem =
          error instanceof Error
            ? error.message
            : "Could not prevent automatic sleep.";
      }
    }
  }
  return {
    ready,
    read: () =>
      serial(() => {
        if (loadError) {
          throw loadError;
        }
        return state();
      }),
    setActiveTasks(count: number) {
      activeTasks = count;
      return serial(async () => {
        await reconcile();
      });
    },
    request(request: ComputerPowerRequest) {
      return serial(async () => {
        if (loadError) {
          throw loadError;
        }
        if (request.operation === "update") {
          if (!supported) {
            throw new Error(
              "Sleep prevention is not supported on this operating system."
            );
          }
          if (request.expectedRevision !== revision) {
            throw new Error(
              "This setting changed elsewhere. Refresh and try again."
            );
          }
          const next = { enabled: request.enabled, revision: revision + 1 };
          await mkdir(dirname(input.path), { recursive: true });
          const temporary = `${input.path}.tmp`;
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          await rename(temporary, input.path);
          enabled = next.enabled;
          revision = next.revision;
          problem = null;
          await reconcile();
        }
        return state();
      });
    },
    stop() {
      stopped = true;
      return serial(reconcile);
    },
  };
}
