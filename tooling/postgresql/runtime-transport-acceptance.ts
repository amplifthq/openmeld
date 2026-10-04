// biome-ignore-all lint/suspicious/noMisplacedAssertion: This operational acceptance checks the actual isolated runtime contract and fails closed.
import assert from "node:assert/strict";
import {
  getPostgresRequestPool,
  type PostgreSQLBinding,
  PostgresDatabase,
  readPostgresErrorCode,
  withPostgresRequest,
} from "@openmeld/db/postgresql";

/** Exercise the product connection owner against the isolated synthetic table. */
export async function acceptRuntimeTransport(
  binding: PostgreSQLBinding
): Promise<void> {
  const id = crypto.randomUUID();
  const rollback = new Error("synthetic transaction rollback");
  const pool = await withPostgresRequest(binding, async () => {
    const current = getPostgresRequestPool();
    const db = new PostgresDatabase(binding);
    assert.equal(
      (
        await db.query("SHOW server_version_num")
      ).rows[0].server_version_num.slice(0, 2),
      "18"
    );
    try {
      await assert.rejects(
        db.transaction(async (client) => {
          await client.query(
            "INSERT INTO openmeld_probe.records(id, payload) VALUES ($1, $2::jsonb)",
            [id, JSON.stringify({ marker: id })]
          );
          throw rollback;
        }),
        (error) => error === rollback
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM openmeld_probe.records WHERE id=$1",
            [id]
          )
        ).rows[0].count,
        0
      );
      await db.transaction(async (client) => {
        await client.query(
          "INSERT INTO openmeld_probe.records(id, payload) VALUES ($1, $2::jsonb)",
          [id, JSON.stringify({ marker: id })]
        );
        await client.query(
          "UPDATE openmeld_probe.records SET payload=$2::jsonb WHERE id=$1",
          [id, JSON.stringify({ marker: `${id}-committed` })]
        );
      });
      assert.equal(
        (
          await db.query(
            "SELECT payload->>'marker' AS marker FROM openmeld_probe.records WHERE id=$1",
            [id]
          )
        ).rows[0].marker,
        `${id}-committed`
      );
      await assert.rejects(
        db.query("SELECT 1 / 0"),
        (error) => readPostgresErrorCode(error) === "22012"
      );
    } finally {
      await db.query("DELETE FROM openmeld_probe.records WHERE id=$1", [id]);
    }
    return current;
  });
  assert.equal(
    pool.totalCount,
    0,
    "The product owner must close its request pool"
  );
}
