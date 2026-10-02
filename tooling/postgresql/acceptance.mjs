// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function acceptRuntime(client) {
  const id = randomUUID();
  const payload = JSON.stringify({ synthetic: true, marker: id });
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query(
      "INSERT INTO openmeld_probe.records(id, payload) VALUES ($1, $2::jsonb)",
      [id, payload]
    );
    await client.query("ROLLBACK");
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM openmeld_probe.records WHERE id=$1",
          [id]
        )
      ).rows[0].count,
      0,
      "Transaction rollback"
    );
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO openmeld_probe.records(id, payload) VALUES ($1, $2::jsonb)",
      [id, payload]
    );
    await client.query("COMMIT");
    assert.equal(
      (
        await client.query(
          "SELECT payload->>'marker' AS marker FROM openmeld_probe.records WHERE id=$1",
          [id]
        )
      ).rows[0].marker,
      id,
      "Read after write"
    );
    await client.query(
      "UPDATE openmeld_probe.records SET payload=$2::jsonb WHERE id=$1",
      [id, JSON.stringify({ marker: `${id}-updated` })]
    );
    assert.equal(
      (
        await client.query(
          "SELECT payload->>'marker' AS marker FROM openmeld_probe.records WHERE id=$1",
          [id]
        )
      ).rows[0].marker,
      `${id}-updated`,
      "Read after update must not return cached content"
    );
    for (const statement of [
      "CREATE TABLE openmeld.forbidden_probe(id int)",
      "SELECT * FROM openmeld_meta.migrations",
      "TRUNCATE openmeld_probe.records",
    ]) {
      await client.query("BEGIN");
      let code;
      try {
        await client.query(statement);
      } catch (error) {
        code = error.code;
      } finally {
        await client.query("ROLLBACK");
      }
      assert.equal(
        code,
        "42501",
        "Runtime must reject DDL, migration-ledger reads, and TRUNCATE"
      );
    }
    return {
      commit: true,
      rollback: true,
      readAfterWrite: true,
      readAfterUpdate: true,
      permissionDenied: true,
    };
  } finally {
    await client.query("ROLLBACK");
    await client.query("DELETE FROM openmeld_probe.records WHERE id=$1", [id]);
  }
}
