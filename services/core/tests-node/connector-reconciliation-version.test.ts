import { describe, expect, it, onTestFinished } from "vitest";
import {
  createSharedConnectorConnectionName,
  markConnectorConnectionDisconnected,
  reconcileConnectorConnections,
  requireConnectorConnection,
  requireConnectorConnectionForExecution,
  selectActiveConnectorConnection,
  upsertPendingConnectorConnection,
  upsertPendingSharedConnectorConnection,
} from "../src/connectors/connector-connection-repository";
import {
  readPluginAccess,
  requirePluginPermission,
  updatePluginAccess,
} from "../src/connectors/plugin-access";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("connection authorization identity during status reconciliation", () => {
  it.each([
    "gmail",
    "outlook_calendar",
    "zoom",
  ])("blocks shared %s authorization and legacy execution while preserving personal access and owner cleanup", async (service) => {
    const harness = await createPostgresHarness();
    onTestFinished(() => harness.close());
    const db = harness.db;
    await db.query(
      `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('team','Team','team',1)`
    );
    await db.query(
      `INSERT INTO "openmeld"."users" (id,name,email,created_at,updated_at) VALUES ('member','Member','member@example.test',1,1)`
    );
    const base = {
      db,
      organizationId: "team",
      userId: "member",
      service,
      nowMs: 1,
    };
    await expect(
      upsertPendingSharedConnectorConnection({
        ...base,
        connectionName: "new-shared",
      })
    ).rejects.toThrow("plugin.connection_scope_forbidden");
    expect(
      (
        await db.query(
          'SELECT connection_name FROM "openmeld"."connector_connections"'
        )
      ).rows
    ).toEqual([]);
    const oldPolicy = {
      center_agent: "write",
      local_agent: "read",
      remote_agent: "write",
    } as const;
    await db.query({
      text: `INSERT INTO "openmeld"."connector_connections"
        (connection_name,organization_id,user_id,scope,service,status,created_at_ms,updated_at_ms,access_policy)
        VALUES ('old-shared','team','member','shared',$1,'active',1,1,$2)`,
      values: [service, JSON.stringify(oldPolicy)],
    });
    const old = { db, organizationId: "team", connectionName: "old-shared" };
    expect(await readPluginAccess(old)).toEqual({
      policy: {
        center_agent: "none",
        local_agent: "none",
        remote_agent: "none",
      },
      revision: 0,
    });
    await expect(requireConnectorConnectionForExecution(old)).rejects.toThrow(
      "plugin.connection_scope_forbidden"
    );
    for (const consumer of [
      "center_agent",
      "local_agent",
      "remote_agent",
    ] as const) {
      await expect(
        requirePluginPermission({ ...old, consumer, effect: "read" })
      ).rejects.toThrow("plugin.action_forbidden");
    }
    await expect(
      updatePluginAccess({
        ...old,
        actorProfileId: "human",
        actorUserId: "member",
        expectedRevision: 0,
        policy: oldPolicy,
      })
    ).rejects.toThrow("plugin.connection_scope_forbidden");
    const selection = {
      db,
      organizationId: "team",
      requesterUserId: "member",
      service,
    };
    expect(
      await selectActiveConnectorConnection({
        ...selection,
        preference: "automatic",
      })
    ).toBeNull();
    expect(
      await selectActiveConnectorConnection({
        ...selection,
        preference: "shared",
      })
    ).toBeNull();
    await upsertPendingConnectorConnection({
      ...base,
      connectionName: "personal",
    });
    await reconcileConnectorConnections({
      ...base,
      availableConnectionNames: ["old-shared", "personal"],
      nowMs: 2,
    });
    expect(
      (
        await selectActiveConnectorConnection({
          ...selection,
          preference: "automatic",
        })
      )?.connection
    ).toMatchObject({ connectionName: "personal", scope: "member" });
    expect(
      await requireConnectorConnectionForExecution({
        ...old,
        connectionName: "personal",
      })
    ).toMatchObject({ service, scope: "member" });
    expect(
      await markConnectorConnectionDisconnected({ ...old, nowMs: 3 })
    ).toMatchObject({ status: "disconnected", scope: "shared" });
  });
  it("keeps a shared connection usable after its installer leaves and permits another member to reconnect", async () => {
    const harness = await createPostgresHarness();
    onTestFinished(() => harness.close());
    const db = harness.db;
    await db.query(
      `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('team','Team','team',1)`
    );
    await db.query(
      `INSERT INTO "openmeld"."users" (id,name,email,created_at,updated_at) VALUES ('installer','Installer','installer@example.test',1,1),('member','Member','member@example.test',1,1)`
    );
    const connectionName = await createSharedConnectorConnectionName({
      organizationId: "team",
      service: "github",
    });
    const connection = {
      db,
      connectionName,
      organizationId: "team",
      service: "github" as const,
      userId: "installer",
      nowMs: 1,
    };
    await upsertPendingSharedConnectorConnection(connection);
    const reconcile = (availableConnectionNames: string[], nowMs: number) =>
      reconcileConnectorConnections({
        db,
        organizationId: "team",
        service: "github",
        availableConnectionNames,
        nowMs,
      });
    await reconcile([connectionName], 2);
    await db.query(
      `UPDATE "openmeld"."users" SET deleted_at = 3 WHERE id = 'installer'`
    );
    await reconcile([], 4);
    expect((await requireConnectorConnection(connection)).status).toBe(
      "pending"
    );
    await reconcile([connectionName], 5);
    expect((await requireConnectorConnection(connection)).status).toBe(
      "active"
    );
    await expect(
      upsertPendingSharedConnectorConnection({ ...connection, nowMs: 6 })
    ).rejects.toThrow("account_unavailable");
    expect(
      await upsertPendingSharedConnectorConnection({
        ...connection,
        userId: "member",
        nowMs: 7,
      })
    ).toMatchObject({ userId: "member", status: "pending" });
  });
  it("keeps a healthy account's version stable and changes it only when access actually changes", async () => {
    const harness = await createPostgresHarness();
    const db = harness.db;
    await harness.query(`INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ('org-1', 'Organization', 'organization', 1)`);
    await harness.query(`INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
      VALUES ('connected-user', 'Connected', 'connected@example.test', 1, 1),
        ('pending-user', 'Pending', 'pending@example.test', 1, 1),
        ('disconnected-user', 'Disconnected', 'disconnected@example.test', 1, 1)`);
    await harness.query(`INSERT INTO "openmeld"."connector_connections"
      (connection_name, organization_id, user_id, service, status, created_at_ms, updated_at_ms, disconnected_at_ms)
      VALUES ('connected', 'org-1', 'connected-user', 'github', 'active', 10, 10, NULL),
        ('pending', 'org-1', 'pending-user', 'github', 'pending', 10, 10, NULL),
        ('disconnected', 'org-1', 'disconnected-user', 'github', 'disconnected', 10, 10, 10)`);
    const state = (name: string) =>
      harness.queryFirst({
        text: 'SELECT status, updated_at_ms FROM "openmeld"."connector_connections" WHERE connection_name = $1',
        values: [name],
      });
    try {
      const available = ["connected", "pending", "disconnected"];
      await reconcileConnectorConnections({
        db,
        nowMs: 20,
        organizationId: "org-1",
        service: "github",
        availableConnectionNames: available,
      });
      expect(await state("connected")).toEqual({
        status: "active",
        updated_at_ms: 10,
      });
      expect(await state("pending")).toEqual({
        status: "active",
        updated_at_ms: 20,
      });
      expect(await state("disconnected")).toEqual({
        status: "disconnected",
        updated_at_ms: 10,
      });
      await reconcileConnectorConnections({
        db,
        nowMs: 30,
        organizationId: "org-1",
        service: "github",
        availableConnectionNames: [],
      });
      expect(await state("connected")).toEqual({
        status: "pending",
        updated_at_ms: 30,
      });
      await reconcileConnectorConnections({
        db,
        nowMs: 40,
        organizationId: "org-1",
        service: "github",
        availableConnectionNames: available,
      });
      expect(await state("connected")).toEqual({
        status: "active",
        updated_at_ms: 40,
      });
      await reconcileConnectorConnections({
        db,
        nowMs: 50,
        organizationId: "org-1",
        service: "github",
        availableConnectionNames: available,
      });
      expect(await state("connected")).toEqual({
        status: "active",
        updated_at_ms: 40,
      });
    } finally {
      await harness.close();
    }
  });
});
