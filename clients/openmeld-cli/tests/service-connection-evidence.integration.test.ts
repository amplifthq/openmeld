import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceConnectionEvidenceJournalSchema } from "@openmeld/schemas";
import type {
  ServiceConnectionEvidenceEvent,
  ServiceConnectionIncidentReport,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daemonRuntimeStateRootPath } from "../src/config/daemon-state";
import {
  createServiceConnectionEvidenceRecorder,
  readServiceConnectionFailureEvidence,
} from "../src/local-service/lifecycle/service-connection-evidence";
import { WebSocketConnectionError } from "../src/transport/ws";

let home: string;
const recorders: ReturnType<typeof createServiceConnectionEvidenceRecorder>[] =
  [];
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "openmeld-connection-evidence-"));
  vi.stubEnv("OPENMELD_HOME", home);
});
afterEach(async () => {
  for (const recorder of recorders.splice(0)) {
    recorder.dispose();
    await recorder.flush();
  }
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

function fixture(ownerUserId = "owner-a", serviceSessionId = randomUUID()) {
  const reports: ServiceConnectionIncidentReport[] = [];
  const recorder = createServiceConnectionEvidenceRecorder({
    ownerUserId,
    gatewayUrl: "https://gateway.openmeld.ai",
    identity: {
      deviceId: "test-device",
      runtimeLane: "prod",
      serviceSessionId,
      serviceVersion: "0.3.205",
    },
    sendIncident: (report) => {
      reports.push(structuredClone(report));
      return Promise.resolve({
        incidentId: report.incident.incidentId,
        receivedAtMs: Date.now(),
      });
    },
  });
  recorders.push(recorder);
  return { recorder, reports };
}

function event(
  overrides: Partial<ServiceConnectionEvidenceEvent> = {}
): ServiceConnectionEvidenceEvent {
  return {
    kind: "disconnected",
    connectionId: randomUUID(),
    firstAtMs: Date.now(),
    lastAtMs: Date.now(),
    count: 1,
    phase: "opening",
    reason: "open_timeout",
    ...overrides,
  };
}

async function journals() {
  const root = daemonRuntimeStateRootPath();
  const paths = (await readdir(root)).filter((name) =>
    name.startsWith("connection-evidence-")
  );
  return await Promise.all(
    paths.map(async (name) => {
      const raw = await readFile(join(root, name), "utf8");
      return {
        raw,
        journal: serviceConnectionEvidenceJournalSchema.parse(JSON.parse(raw)),
      };
    })
  );
}

describe("bounded Service connection evidence", () => {
  it("keeps offline evidence, uploads the recovered immutable incident once, and acknowledges it on disk", async () => {
    const { recorder, reports } = fixture();
    const recovery = { recoveryId: randomUUID(), disconnectedAt: Date.now() };
    recorder.record({ recovery, event: event() });
    await recorder.flush();
    expect(reports).toEqual([]);
    recorder.record({
      recovery,
      event: event({
        kind: "registered",
        reason: "recovered",
        phase: "online",
      }),
    });
    await recorder.flush();
    recorder.setOnline(true);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    await recorder.flush();
    expect(reports[0]?.incident.outcome).toBe("recovered");
    expect(
      (await journals())[0]?.journal.entries[0]?.uploadedAtMs
    ).not.toBeNull();
    recorder.setOnline(false);
    recorder.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reports).toHaveLength(1);
  });

  it("uploads an interrupted previous process after restart, while another account cannot read or send it", async () => {
    const first = fixture();
    first.recorder.record({
      recovery: { recoveryId: randomUUID(), disconnectedAt: Date.now() },
      event: event(),
    });
    await first.recorder.flush();
    first.recorder.dispose();
    const other = fixture("owner-b");
    other.recorder.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(other.reports).toEqual([]);
    const resumed = fixture();
    resumed.recorder.setOnline(true);
    await vi.waitFor(() => expect(resumed.reports).toHaveLength(1));
    expect(resumed.reports[0]?.incident.outcome).toBe("interrupted");
    expect(resumed.reports[0]?.uploaderServiceSessionId).not.toBe(
      resumed.reports[0]?.incident.serviceSessionId
    );
  });

  it("bounds incidents and event history, rejects arbitrary payloads, and expires seven-day-old records", async () => {
    const { recorder } = fixture();
    const old = Date.now() - 8 * 24 * 60 * 60_000;
    recorder.record({
      recovery: { recoveryId: randomUUID(), disconnectedAt: old },
      event: event({ firstAtMs: old, lastAtMs: old }),
    });
    await recorder.flush();
    expect((await journals())[0]?.journal.entries).toEqual([]);
    for (let i = 0; i < 35; i += 1) {
      recorder.record({
        recovery: { recoveryId: randomUUID(), disconnectedAt: Date.now() },
        event: event(),
      });
    }
    const recovery = { recoveryId: randomUUID(), disconnectedAt: Date.now() };
    for (let i = 0; i < 110; i += 1) {
      recorder.record({ recovery, event: event() });
    }
    recorder.record({
      recovery,
      event: {
        ...event(),
        token: "must-not-persist",
      } as ServiceConnectionEvidenceEvent,
    });
    await recorder.flush();
    const result = (await journals())[0];
    expect(result?.journal.entries).toHaveLength(32);
    expect(result?.journal.entries.at(-1)?.incident.events).toHaveLength(100);
    expect(result?.journal.entries.at(-1)?.incident.evidenceTruncated).toBe(
      true
    );
    expect(Buffer.byteLength(result?.raw ?? "")).toBeLessThanOrEqual(
      1024 * 1024
    );
    expect(result?.raw).not.toContain("must-not-persist");
  });

  it("retains only runtime-provided safe error evidence without inventing a network cause", () => {
    expect(
      readServiceConnectionFailureEvidence(new Error("DNS or secret token"))
    ).toEqual({ reason: "unknown" });
    expect(
      readServiceConnectionFailureEvidence(
        Object.assign(new Error("secret"), { code: "ECONNRESET" })
      )
    ).toEqual({ reason: "unknown", nativeErrorCode: "ECONNRESET" });
    expect(
      readServiceConnectionFailureEvidence(
        new WebSocketConnectionError("secret", "open_timeout")
      )
    ).toEqual({ reason: "open_timeout" });
  });
});
