import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { reconcileConnectorConnections } from "../src/connectors/connector-connection-repository";

describe("connection authorization identity during status reconciliation", () => {
  it("keeps a healthy account's version stable and changes it only when access actually changes", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE connector_connections (connection_name TEXT PRIMARY KEY, organization_id TEXT, service TEXT, status TEXT, updated_at_ms INTEGER, disconnected_at_ms INTEGER);
      INSERT INTO connector_connections VALUES ('connected', 'org-1', 'github', 'active', 10, NULL), ('pending', 'org-1', 'github', 'pending', 10, NULL), ('disconnected', 'org-1', 'github', 'disconnected', 10, 10);`);
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: SQLInputValue[]) => ({
          run: () => sqlite.prepare(sql).run(...values),
        }),
      }),
      batch: async (statements: { run(): unknown }[]) =>
        statements.map((statement) => statement.run()),
    } as unknown as D1Database;
    const state = (name: string) =>
      sqlite
        .prepare(
          "SELECT status, updated_at_ms FROM connector_connections WHERE connection_name=?"
        )
        .get(name);
    try {
      const available = ["connected", "pending", "disconnected"];
      await reconcileConnectorConnections({
        db,
        nowMs: 20,
        organizationId: "org-1",
        service: "github",
        availableConnectionNames: available,
      });
      expect(state("connected")).toEqual({
        status: "active",
        updated_at_ms: 10,
      });
      expect(state("pending")).toEqual({ status: "active", updated_at_ms: 20 });
      expect(state("disconnected")).toEqual({
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
      expect(state("connected")).toEqual({
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
      expect(state("connected")).toEqual({
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
      expect(state("connected")).toEqual({
        status: "active",
        updated_at_ms: 40,
      });
    } finally {
      sqlite.close();
    }
  });
});
