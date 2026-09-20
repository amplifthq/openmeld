import type {
  DesktopUpdateObservation,
  DesktopUpdateObservationRpcInput,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  reportDesktopUpdateObservation,
  rpcReportDesktopUpdateObservation,
} from "../src/computers/desktop-update-inbox";
import { createInboxService } from "../src/inbox/application/inbox-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";
import { applyDrizzleMigrationsForTables } from "./helpers/sqlite-d1-harness.test-support";

const installationId = "11111111-2222-4333-8444-555555555555";
const observation: DesktopUpdateObservation = {
  schemaVersion: 1,
  expectedUserId: "owner",
  installationId,
  sequence: 1,
  lane: "dev-local",
  deviceName: "Test Mac",
  platform: "darwin",
  installedVersion: "0.1.3",
  availableVersion: "0.1.4",
};

describe("native Desktop update Inbox source", () => {
  it("serializes concurrent source reports without leaving an outdated active offer", async () => {
    const f = fixture();
    try {
      await Promise.all([
        f.report(observation),
        f.report({ ...observation, sequence: 2, availableVersion: "0.1.5" }),
        f.report({ ...observation, sequence: 3, availableVersion: "0.1.6" }),
      ]);
      const available = f
        .items()
        .map((row) => JSON.parse(String(row.source_target_json)))
        .filter((target) => target.state === "available");
      expect(available).toHaveLength(1);
      expect(available[0].version).toBe("0.1.6");
    } finally {
      f.close();
    }
  });
  it("keeps one quiet canonical item across checks, read and Dismiss; native install confirmation changes source truth only", async () => {
    const f = fixture();
    try {
      await f.report(observation);
      await f.report(observation);
      await f.report({ ...observation, sequence: 2 });
      const original = f.items()[0];
      if (!original) {
        throw new Error("Expected native update projection");
      }
      expect(f.items()).toHaveLength(1);
      expect(original).toMatchObject({
        organization_id: null,
        importance: "normal",
        resolution_status: "not_applicable",
      });
      const inbox = createInboxService({ db: f.db, includeAccountItems: true });
      await inbox.markRead({
        ...f.identity,
        itemId: String(original.id),
        read: true,
      });
      await inbox.dismiss({
        ...f.identity,
        organizationId: "other-org",
        itemId: String(original.id),
      });
      const read = f.items()[0]?.read_at_ms;
      const cleared = f.items()[0]?.cleared_at_ms;
      await f.report({ ...observation, sequence: 3 });
      expect(JSON.parse(String(f.items()[0]?.source_target_json)).state).toBe(
        "available"
      );
      await f.report({
        ...observation,
        availableVersion: undefined,
        installedVersion: "0.1.4",
        sequence: 4,
      });
      expect(f.items()[0]).toMatchObject({
        id: original.id,
        read_at_ms: read,
        cleared_at_ms: cleared,
        occurred_at_ms: original.occurred_at_ms,
      });
      expect(JSON.parse(String(f.items()[0]?.source_target_json)).state).toBe(
        "installed"
      );
      expect(
        f.queryAll({ sql: "SELECT * FROM inbox_email_deliveries" })
      ).toEqual([]);
    } finally {
      f.close();
    }
  });

  it("supersedes older offers without claiming installation, rejects replay conflicts and ignores stale reports", async () => {
    const f = fixture();
    try {
      await f.report(observation);
      await f.report({
        ...observation,
        sequence: 3,
        availableVersion: "0.1.5",
      });
      expect(
        f.items().map((row) => JSON.parse(String(row.source_target_json)).state)
      ).toEqual(["superseded", "available"]);
      await expect(f.report({ ...observation, sequence: 2 })).resolves.toEqual({
        accepted: false,
        sequence: 3,
      });
      await expect(
        f.report({ ...observation, sequence: 3 })
      ).rejects.toMatchObject({ status: 409 });
      await f.report({
        ...observation,
        sequence: 4,
        availableVersion: undefined,
      });
      expect(
        f
          .items()
          .filter(
            (row) =>
              JSON.parse(String(row.source_target_json)).state === "available"
          )
      ).toHaveLength(1);
      await f.report({ ...observation, sequence: 5, availableVersion: null });
      expect(
        f
          .items()
          .every(
            (row) =>
              JSON.parse(String(row.source_target_json)).state === "superseded"
          )
      ).toBe(true);
    } finally {
      f.close();
    }
  });

  it("uses an atomic source sequence and projection batch so a failed write retries without a receipt or duplicate", async () => {
    const f = fixture();
    try {
      f.run({
        sql: "CREATE TRIGGER fail_desktop_update BEFORE INSERT ON inbox_items BEGIN SELECT RAISE(ABORT, 'source projection failure'); END",
      });
      await expect(f.report(observation)).rejects.toThrow();
      expect(f.items()).toEqual([]);
      expect(
        f.queryAll({ sql: "SELECT * FROM desktop_update_installations" })
      ).toEqual([]);
      f.run({ sql: "DROP TRIGGER fail_desktop_update" });
      await f.report(observation);
      expect(f.items()).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it("binds the account to verified Human identity and rejects mismatched users, arbitrary fields and invalid availability", async () => {
    const f = fixture();
    try {
      const env = { OPENMELD_DB: f.db } as unknown as CoreBindings;
      const context = {
        actorContext: {
          callerPrincipalId: "owner",
          ownerUserId: "owner",
          profileKind: "human" as const,
          profileName: "Owner",
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          requestId: "desktop-test",
        },
      };
      await expect(
        rpcReportDesktopUpdateObservation(env, { context, observation })
      ).resolves.toMatchObject({ accepted: true });
      await expect(
        rpcReportDesktopUpdateObservation(env, {
          context,
          observation: { ...observation, expectedUserId: "other" },
        })
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        rpcReportDesktopUpdateObservation(env, {
          context: {
            actorContext: { ...context.actorContext, profileKind: "agent" },
          },
          observation,
        })
      ).rejects.toMatchObject({ status: 403 });
      const invalid = {
        context,
        observation: { ...observation, organizationId: "org" },
      } as DesktopUpdateObservationRpcInput;
      await expect(
        rpcReportDesktopUpdateObservation(env, invalid)
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        f.report({ ...observation, sequence: 2, availableVersion: "0.1.2" })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      f.close();
    }
  });
});

function fixture() {
  const f = createInboxFeedFixture();
  applyDrizzleMigrationsForTables(f, ["desktop_update_installations"]);
  let nowMs = 10_000;
  return {
    ...f,
    report: (value: DesktopUpdateObservation) =>
      reportDesktopUpdateObservation({
        db: f.db,
        observation: value,
        nowMs: nowMs++,
      }),
    items: () =>
      f.queryAll({
        sql: "SELECT * FROM inbox_items WHERE kind = 'desktop_update' ORDER BY occurred_at_ms",
      }),
  };
}
