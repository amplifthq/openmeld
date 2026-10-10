import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { formatCutoverDataFailure } from "./cutover.mjs";
import {
  closeMigrationClient,
  readMigrations,
  readMigrationsAtSource,
} from "./database.mjs";

const EXACT_SOURCE_ERROR = /exact source SHA/u;

test("historical retry proof uses the same immutable hashes and order as the native migrator", async () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const expected = (await readMigrations()).map(
    ({ name, hash, checksum, folderMillis }) => ({
      name,
      hash,
      checksum,
      folderMillis,
    })
  );
  assert.deepEqual(readMigrationsAtSource(source), expected);
  assert.throws(() => readMigrationsAtSource("main"), EXACT_SOURCE_ERROR);
});

function clientWithShutdown(end) {
  const client = new EventEmitter();
  client.end = () => end(client);
  return client;
}

test("reports the wrapped driver code without SQL or private parameter content", () => {
  const driver = Object.assign(new Error("private row data"), {
    code: "23503",
  });
  const wrapped = new Error("Failed query with private parameters", {
    cause: driver,
  });
  assert.equal(
    formatCutoverDataFailure(wrapped),
    "Cutover data operation failed (23503); preserve source and target"
  );
});

test("reports the observed peer TLS shutdown error without losing completed work", async () => {
  const warnings = [];
  const client = clientWithShutdown((emitter) => {
    emitter.emit(
      "error",
      Object.assign(new Error("peer closed"), {
        code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
      })
    );
  });
  await closeMigrationClient(client, (message) => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.equal(client.listenerCount("error"), 0);
});

test("rejects other shutdown errors and preserves end rejection", async () => {
  const failure = new Error("unexpected transport failure");
  const client = clientWithShutdown((emitter) =>
    emitter.emit("error", failure)
  );
  await assert.rejects(closeMigrationClient(client), (error) => {
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  const rejected = clientWithShutdown(() => Promise.reject(failure));
  await assert.rejects(
    closeMigrationClient(rejected),
    (error) => error === failure
  );
  assert.equal(rejected.listenerCount("error"), 0);
});

test("does not handle an error outside explicit shutdown", async () => {
  const client = clientWithShutdown(() => Promise.resolve());
  const failure = Object.assign(new Error("live TLS failure"), {
    code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
  });
  assert.throws(
    () => client.emit("error", failure),
    (error) => error === failure
  );
  await closeMigrationClient(client);
  assert.throws(
    () => client.emit("error", failure),
    (error) => error === failure
  );
});
