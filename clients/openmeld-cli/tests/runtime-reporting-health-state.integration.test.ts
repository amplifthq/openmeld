import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeReportingHealthStateSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenMeldPathResolutionInput } from "../src/config/paths";
import {
  readRuntimeReportingHealthState,
  recordRuntimeReportingFailure,
  recordRuntimeReportingSuccess,
  runtimeReportingHealthStatePath,
} from "../src/local-service/state/runtime-reporting-health-state";

const tempDirectories = new Set<string>();
const TEST_SERVICE_IDENTITY = {
  contractGeneration: 1,
  deviceId: "device-test",
} as const;

afterEach(async () => {
  await Promise.all(
    [...tempDirectories].map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
      tempDirectories.delete(directory);
    })
  );
});

describe("runtime reporting health state", () => {
  it("accumulates failures in private schema-validated daemon state", async () => {
    const { pathInput } = await createIsolatedPathInput();

    await recordRuntimeReportingFailure({
      channel: "runtimeAgentController",
      at: "2026-07-10T01:00:00.000Z",
      reasonCode: "authentication_required",
      message: "authentication required",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });
    const secondFailure = await recordRuntimeReportingFailure({
      channel: "runtimeAgentController",
      at: "2026-07-10T01:01:00.000Z",
      reasonCode: "request_timeout",
      message: "request timed out",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });

    expect(secondFailure.runtimeAgentController).toEqual({
      applicability: {
        observedAt: "2026-07-10T01:01:00.000Z",
        status: "applicable",
      },
      lastSuccessAt: null,
      consecutiveFailures: 2,
      lastFailure: {
        at: "2026-07-10T01:01:00.000Z",
        reasonCode: "request_timeout",
        message: "request timed out",
      },
    });
    await expect(readRuntimeReportingHealthState(pathInput)).resolves.toEqual(
      secondFailure
    );

    const path = runtimeReportingHealthStatePath(pathInput);
    const persisted = JSON.parse(await readFile(path, "utf8")) as unknown;
    expect(runtimeReportingHealthStateSchema.safeParse(persisted).success).toBe(
      true
    );
    expect((await stat(path)).mode.toString(8).slice(-3)).toBe("600");
  });

  it("clears consecutive failure details after a successful report", async () => {
    const { pathInput } = await createIsolatedPathInput();

    await recordRuntimeReportingFailure({
      channel: "runtimeAgentController",
      at: "2026-07-10T02:00:00.000Z",
      reasonCode: "authentication_required",
      message: "authentication required",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });
    const recovered = await recordRuntimeReportingSuccess({
      channel: "runtimeAgentController",
      at: "2026-07-10T02:01:00.000Z",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });

    expect(recovered.runtimeAgentController).toEqual({
      applicability: {
        observedAt: "2026-07-10T02:01:00.000Z",
        status: "applicable",
      },
      lastSuccessAt: "2026-07-10T02:01:00.000Z",
      consecutiveFailures: 0,
      lastFailure: null,
    });
  });

  it("tracks channels independently and preserves the last success", async () => {
    const { pathInput } = await createIsolatedPathInput();

    await recordRuntimeReportingSuccess({
      channel: "runtimeAgentController",
      at: "2026-07-10T03:00:00.000Z",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });
    await recordRuntimeReportingFailure({
      channel: "providerConversationProof",
      at: "2026-07-10T03:01:00.000Z",
      reasonCode: "proof_rejected",
      message: "conversation proof was rejected",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });
    const state = await recordRuntimeReportingFailure({
      channel: "runtimeAgentController",
      at: "2026-07-10T03:02:00.000Z",
      reasonCode: "request_timeout",
      message: "request timed out",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });

    expect(state.runtimeAgentController).toEqual({
      applicability: {
        observedAt: "2026-07-10T03:02:00.000Z",
        status: "applicable",
      },
      lastSuccessAt: "2026-07-10T03:00:00.000Z",
      consecutiveFailures: 1,
      lastFailure: {
        at: "2026-07-10T03:02:00.000Z",
        reasonCode: "request_timeout",
        message: "request timed out",
      },
    });
    expect(state.providerConversationProof).toEqual({
      applicability: {
        observedAt: "2026-07-10T03:01:00.000Z",
        status: "applicable",
      },
      lastSuccessAt: null,
      consecutiveFailures: 1,
      lastFailure: {
        at: "2026-07-10T03:01:00.000Z",
        reasonCode: "proof_rejected",
        message: "conversation proof was rejected",
      },
    });
  });

  it("serializes concurrent updates without losing failures", async () => {
    const { pathInput } = await createIsolatedPathInput();

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        recordRuntimeReportingFailure({
          channel: "runtimeAgentController",
          at: `2026-07-10T04:00:0${index}.000Z`,
          reasonCode: "request_timeout",
          message: `request ${index} timed out`,
          pathInput,
          serviceIdentity: TEST_SERVICE_IDENTITY,
        })
      )
    );

    const state = await readRuntimeReportingHealthState(pathInput);
    expect(state?.runtimeAgentController.consecutiveFailures).toBe(8);
  });

  it("stores bounded single-line failure diagnostics", async () => {
    const { pathInput } = await createIsolatedPathInput();

    const state = await recordRuntimeReportingFailure({
      channel: "runtimeAgentController",
      message: `request failed\n${"x".repeat(600)}`,
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
      reasonCode: `runtime.reporting.write_failed\n${"y".repeat(200)}`,
    });

    const lastFailure = state.runtimeAgentController.lastFailure;
    expect(lastFailure?.message).not.toContain("\n");
    expect(lastFailure?.message.length).toBe(500);
    expect(lastFailure?.reasonCode).not.toContain("\n");
    expect(lastFailure?.reasonCode.length).toBe(160);
  });

  it("discards observations recorded for a different service identity", async () => {
    const { pathInput } = await createIsolatedPathInput();

    await recordRuntimeReportingSuccess({
      channel: "runtimeAgentController",
      at: "2026-07-10T05:00:00.000Z",
      pathInput,
      serviceIdentity: { contractGeneration: 3, deviceId: "device-old" },
    });

    const state = await readRuntimeReportingHealthState(pathInput, {
      contractGeneration: 4,
      deviceId: "device-new",
    });

    expect(state).toMatchObject({
      serviceIdentity: { contractGeneration: 4, deviceId: "device-new" },
      runtimeAgentController: {
        consecutiveFailures: 0,
        lastFailure: null,
        lastSuccessAt: null,
      },
    });
  });

  it("reads a legacy identity-free file without trusting its observations", async () => {
    const { pathInput } = await createIsolatedPathInput();
    await recordRuntimeReportingSuccess({
      channel: "runtimeAgentController",
      at: "2026-07-10T06:00:00.000Z",
      pathInput,
      serviceIdentity: TEST_SERVICE_IDENTITY,
    });
    const path = runtimeReportingHealthStatePath(pathInput);
    const legacyState = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    legacyState.serviceIdentity = undefined;
    await writeFile(path, `${JSON.stringify(legacyState)}\n`, "utf8");

    const state = await readRuntimeReportingHealthState(pathInput, {
      contractGeneration: 2,
      deviceId: "device-current",
    });

    expect(state).toMatchObject({
      serviceIdentity: {
        contractGeneration: 2,
        deviceId: "device-current",
      },
      runtimeAgentController: {
        consecutiveFailures: 0,
        lastFailure: null,
        lastSuccessAt: null,
      },
    });
  });
});

async function createIsolatedPathInput(): Promise<{
  pathInput: OpenMeldPathResolutionInput;
}> {
  const homeDir = await mkdtemp(join(tmpdir(), "openmeld-reporting-health-"));
  tempDirectories.add(homeDir);
  return {
    pathInput: {
      argv: ["node", "openmeld-dev"],
      env: {
        OPENMELD_HOME: join(homeDir, ".openmeld-dev"),
      },
      homeDir,
    },
  };
}
