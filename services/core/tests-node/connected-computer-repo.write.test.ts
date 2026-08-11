import { describe, expect, it } from "vitest";
import { connectOwnedDeviceToConnectedComputerRecord } from "../src/start/infrastructure/d1/connected-computer-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("connected computer repo write-side", () => {
  it("reassigns a rotated device to the explicitly selected computer and removes the orphan", async () => {
    const harness = createSqliteD1Harness();
    try {
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_connected_computers
            (owner_user_id, connected_computer_id, created_at_ms, updated_at_ms)
          VALUES
            ('owner-1', 'computer-existing', 1, 1),
            ('owner-1', 'computer-duplicate', 2, 2)
        `,
      });
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_owned_devices
            (owner_user_id, device_id, connected_computer_id, first_seen_at_ms, updated_at_ms)
          VALUES
            ('owner-1', 'device-rotated', 'computer-duplicate', 2, 2)
        `,
      });

      await expect(
        connectOwnedDeviceToConnectedComputerRecord({
          connectedAtMs: 3,
          db: harness.db,
          deviceId: "device-rotated",
          requestedConnectedComputerId: "computer-existing",
          userId: "owner-1",
        })
      ).resolves.toEqual({
        connectedComputerId: "computer-existing",
        status: "connected",
      });

      expect(
        harness.queryFirst<{ connected_computer_id: string }>({
          sql: `
            SELECT connected_computer_id
            FROM openMeldDaemon_owned_devices
            WHERE owner_user_id = 'owner-1' AND device_id = 'device-rotated'
          `,
        })
      ).toEqual({ connected_computer_id: "computer-existing" });
      expect(
        harness.queryAll<{ connected_computer_id: string }>({
          sql: `
            SELECT connected_computer_id
            FROM openMeldDaemon_connected_computers
            WHERE owner_user_id = 'owner-1'
            ORDER BY connected_computer_id
          `,
        })
      ).toEqual([{ connected_computer_id: "computer-existing" }]);
    } finally {
      harness.close();
    }
  });
});
