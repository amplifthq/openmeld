import { describe, expect, it } from "vitest";
import { reconcileConnectorConnections } from "../src/connectors/connector-connection-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("connection authorization identity during status reconciliation", () => {
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
