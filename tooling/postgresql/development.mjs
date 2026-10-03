import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileSha256 } from "./d1-snapshot.mjs";
import { connect, grantRuntime, migrate } from "./database.mjs";

const PG18_VERSION_PATTERN = /\b18\./u;
const DEVELOPMENT_DATABASE_PATH_PATTERN = /\/openmeld_pg_development$/u;

// The existing isolated dev launcher owns this cluster's lifetime. Its data
// belongs to the worktree lane and survives normal stack restarts.
export async function startDevelopmentPostgres(stateDirectory, options = {}) {
  const snapshotSha256 = options.snapshot
    ? await fileSha256(options.snapshot)
    : null;
  const root = snapshotSha256
    ? path.join(
        stateDirectory,
        "postgresql-d1-rehearsal",
        `openmeld-pg-${snapshotSha256}`
      )
    : path.join(stateDirectory, "postgresql");
  const bin =
    process.env.OPENMELD_PG_BIN ??
    (existsSync("/opt/homebrew/opt/postgresql@18/bin/initdb")
      ? "/opt/homebrew/opt/postgresql@18/bin"
      : "");
  const executable = (name) => (bin ? path.join(bin, name) : name);
  const version = spawnSync(executable("initdb"), ["--version"], {
    encoding: "utf8",
  });
  if (version.status !== 0 || !PG18_VERSION_PATTERN.test(version.stdout)) {
    throw new Error("PostgreSQL 18 tools are required; set OPENMELD_PG_BIN");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const data = path.join(root, "data");
  const passwordFile = path.join(root, "password");
  const run = (name, args) => {
    const result = spawnSync(executable(name), args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `${name} failed for isolated cluster ${root}: ${result.stderr}`
      );
    }
  };
  if (existsSync(path.join(data, "PG_VERSION"))) {
    if (
      (await readFile(path.join(data, "PG_VERSION"), "utf8")).trim() !== "18"
    ) {
      throw new Error(
        "Existing worktree cluster is not PostgreSQL 18; no data changed"
      );
    }
    if (spawnSync(executable("pg_ctl"), ["-D", data, "status"]).status === 0) {
      throw new Error(
        "This worktree PostgreSQL cluster is already running; stop its owning stack first"
      );
    }
  } else {
    await writeFile(passwordFile, randomBytes(24).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
    run("initdb", [
      "-D",
      data,
      "-U",
      "openmeld_pg_owner",
      "--pwfile",
      passwordFile,
      "--auth-host=scram-sha-256",
      "--auth-local=trust",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  }
  await chmod(passwordFile, 0o600);
  const password = (await readFile(passwordFile, "utf8")).trim();
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const socket = await mkdtemp(path.join(os.tmpdir(), "openmeld-pg-dev-"));
  await chmod(socket, 0o700);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${socket}`,
    "-w",
    "start",
  ]);
  const stop = async () => {
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    await rm(socket, { recursive: true });
  };
  const owner = `postgresql://openmeld_pg_owner:${password}@127.0.0.1:${port}/openmeld_pg_development`;
  try {
    const administrative = await connect(
      owner.replace(DEVELOPMENT_DATABASE_PATH_PATTERN, "/openmeld_pg_admin"),
      true
    ).catch(async (error) => {
      if (error.code !== "3D000") {
        throw error;
      }
      run("createdb", [
        "-h",
        socket,
        "-p",
        String(port),
        "-U",
        "openmeld_pg_owner",
        "openmeld_pg_admin",
      ]);
      return await connect(
        owner.replace(DEVELOPMENT_DATABASE_PATH_PATTERN, "/openmeld_pg_admin"),
        true
      );
    });
    try {
      if (
        !(
          await administrative.query(
            "SELECT 1 FROM pg_roles WHERE rolname='openmeld_pg_runtime'"
          )
        ).rowCount
      ) {
        await administrative.query(
          `CREATE ROLE openmeld_pg_runtime LOGIN PASSWORD '${password}'`
        );
      }
      if (
        !(
          await administrative.query(
            "SELECT 1 FROM pg_database WHERE datname='openmeld_pg_development'"
          )
        ).rowCount
      ) {
        await administrative.query("CREATE DATABASE openmeld_pg_development");
      }
    } finally {
      await administrative.end();
    }
    const client = await connect(owner, true);
    try {
      await migrate(client);
      await grantRuntime(client, "openmeld_pg_runtime");
    } finally {
      await client.end();
    }
    if (options.snapshot) {
      await importDevelopmentSnapshot({
        root,
        owner,
        snapshot: options.snapshot,
        snapshotSha256,
      });
    }
    console.log(
      `[dev:postgresql] PostgreSQL 18 at 127.0.0.1:${port}; state ${root}; synthetic local data persists across restarts.`
    );
    return {
      stop,
      env: {
        OPENMELD_PG_ISOLATED: "1",
        POSTGRESQL_OPENMELD_MIGRATION_URL: owner,
        POSTGRESQL_OPENMELD_RUNTIME_URL: owner.replace(
          "openmeld_pg_owner:",
          "openmeld_pg_runtime:"
        ),
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_OPENMELD_POSTGRESQL:
          owner.replace("openmeld_pg_owner:", "openmeld_pg_runtime:"),
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function importDevelopmentSnapshot({
  root,
  owner,
  snapshot,
  snapshotSha256,
}) {
  const receiptPath = path.join(root, "d1-import.json");
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      receipt.status !== "committed_and_reconciled" ||
      receipt.snapshotSha256 !== snapshotSha256
    ) {
      throw new Error(
        "The local D1 import receipt does not match this snapshot. Preserve the database for diagnosis."
      );
    }
    return;
  }
  // Reuse the local-only migration owner in a child with an explicit isolated
  // environment. Credentials are never command arguments or receipt contents.
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./cli.mjs", import.meta.url)),
      "import-d1",
      "local",
      snapshot,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        OPENMELD_PG_ISOLATED: "1",
        POSTGRESQL_OPENMELD_MIGRATION_URL: owner,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `D1 snapshot import failed. The product was not started. ${result.stderr.trim()}`
    );
  }
  const receipt = JSON.parse(result.stdout);
  if (
    receipt.status !== "committed_and_reconciled" ||
    receipt.snapshotSha256 !== snapshotSha256
  ) {
    throw new Error(
      "D1 snapshot import did not return a matching receipt. Preserve the database for diagnosis."
    );
  }
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}
