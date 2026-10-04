import type {
  DesktopUpdateObservation,
  DesktopUpdateObservationRpcInput,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { installPostgresWriteFailure } from "../../../tooling/postgresql/test-harness";
import {
  reportDesktopUpdateObservation,
  rpcReportDesktopUpdateObservation,
} from "../src/computers/desktop-update-inbox";
import { createInboxService } from "../src/inbox/application/inbox-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";
import { postgresTestBinding } from "./helpers/postgresql-harness.test-support";

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
    const f = await fixture();
    try {
      await Promise.all([
        f.report(observation),
        f.report({ ...observation, sequence: 2, availableVersion: "0.1.5" }),
        f.report({ ...observation, sequence: 3, availableVersion: "0.1.6" }),
      ]);
      const available = (await f.items())
        .map((row) => JSON.parse(String(row.source_target_json)))
        .filter((target) => target.state === "available");
      expect(available).toHaveLength(1);
      expect(available[0].version).toBe("0.1.6");
    } finally {
      await f.close();
    }
  });
  it("keeps one quiet canonical item across checks, read and Dismiss; native install confirmation changes source truth only", async () => {
    const f = await fixture();
    try {
      await f.report(observation);
      await f.report(observation);
      await f.report({ ...observation, sequence: 2 });
      const original = (await f.items())[0];
      if (!original) {
        throw new Error("Expected native update projection");
      }
      expect(await f.items()).toHaveLength(1);
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
      const read = (await f.items())[0]?.read_at_ms;
      const cleared = (await f.items())[0]?.cleared_at_ms;
      await f.report({ ...observation, sequence: 3 });
      expect(
        JSON.parse(String((await f.items())[0]?.source_target_json)).state
      ).toBe("available");
      await f.report({
        ...observation,
        availableVersion: undefined,
        installedVersion: "0.1.4",
        sequence: 4,
      });
      expect((await f.items())[0]).toMatchObject({
        id: original.id,
        read_at_ms: read,
        cleared_at_ms: cleared,
        occurred_at_ms: original.occurred_at_ms,
      });
      expect(
        JSON.parse(String((await f.items())[0]?.source_target_json)).state
      ).toBe("installed");
      expect(
        await f.queryAll({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it("supersedes older offers without claiming installation, rejects replay conflicts and ignores stale reports", async () => {
    const f = await fixture();
    try {
      await f.report(observation);
      await f.report({
        ...observation,
        sequence: 3,
        availableVersion: "0.1.5",
      });
      expect(
        (await f.items()).map(
          (row) => JSON.parse(String(row.source_target_json)).state
        )
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
        (await f.items()).filter(
          (row) =>
            JSON.parse(String(row.source_target_json)).state === "available"
        )
      ).toHaveLength(1);
      await f.report({ ...observation, sequence: 5, availableVersion: null });
      expect(
        (await f.items()).every(
          (row) =>
            JSON.parse(String(row.source_target_json)).state === "superseded"
        )
      ).toBe(true);
    } finally {
      await f.close();
    }
  });

  it("uses an atomic source sequence and projection batch so a failed write retries without a receipt or duplicate", async () => {
    const f = await fixture();
    try {
      const removeFailure = await installPostgresWriteFailure({
        harness: f,
        table: "inbox_items",
        operation: "INSERT",
        message: "source projection failure",
      });
      await expect(f.report(observation)).rejects.toThrow();
      expect(await f.items()).toEqual([]);
      expect(
        await f.queryAll({
          text: 'SELECT * FROM "openmeld"."desktop_update_installations"',
        })
      ).toEqual([]);
      await removeFailure();
      await f.report(observation);
      expect(await f.items()).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it("binds the account to verified Human identity and rejects mismatched users, arbitrary fields and invalid availability", async () => {
    const f = await fixture();
    try {
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(f.db),
      } as unknown as CoreBindings;
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
      await f.close();
    }
  });
});

async function fixture() {
  const f = await createInboxFeedFixture();

  let nowMs = 10_000;
  return {
    ...f,
    report: (value: DesktopUpdateObservation) =>
      reportDesktopUpdateObservation({
        db: f.db,
        observation: value,
        nowMs: nowMs++,
      }),
    items: async () =>
      await f.queryAll({
        text: 'SELECT * FROM "openmeld"."inbox_items" WHERE kind = \'desktop_update\' ORDER BY occurred_at_ms',
      }),
  };
}
