import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { connect } from "./database.mjs";

const [command, ...args] = process.argv.slice(2);
if (
  !["check", "run"].includes(command) ||
  (command === "run" && !args.length)
) {
  throw new Error("Usage: local.mjs check | local.mjs run <command> [args...]");
}
const bin =
  process.env.OPENMELD_PG_BIN ??
  (existsSync("/opt/homebrew/opt/postgresql@18/bin/initdb")
    ? "/opt/homebrew/opt/postgresql@18/bin"
    : "");
const executable = (name) => (bin ? path.join(bin, name) : name);
const version = spawnSync(executable("initdb"), ["--version"], {
  encoding: "utf8",
});
if (version.status !== 0 || !/\b18\./u.test(version.stdout)) {
  throw new Error(
    "PostgreSQL 18 tools are required; set OPENMELD_PG_BIN explicitly"
  );
}
const root = await mkdtemp(path.join(os.tmpdir(), "openmeld-pg-"));
await chmod(root, 0o700);
const password = randomBytes(24).toString("hex");
const passwordFile = path.join(root, "password");
await writeFile(passwordFile, password, { mode: 0o600 });
const data = path.join(root, "data");
const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
let started = false;
function run(name, flags) {
  const result = spawnSync(executable(name), flags, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${name} failed; local cluster at ${root}. ${result.stderr}`
    );
  }
}
try {
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
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${root}`,
    "-w",
    "start",
  ]);
  started = true;
  run("createdb", [
    "-h",
    root,
    "-p",
    String(port),
    "-U",
    "openmeld_pg_owner",
    "openmeld_pg_local",
  ]);
  const owner = `postgresql://openmeld_pg_owner:${password}@127.0.0.1:${port}/openmeld_pg_local`;
  const client = await connect(owner, true);
  try {
    await client.query(
      `CREATE ROLE openmeld_pg_runtime LOGIN PASSWORD '${password}'`
    );
    await client.query("CREATE DATABASE openmeld_pg_restore");
    await client.query("CREATE DATABASE openmeld_pg_other");
  } finally {
    await client.end();
  }
  console.log(
    `Isolated PostgreSQL 18: ${root}; loopback port ${port}; synthetic data only`
  );
  const childArgs =
    command === "check"
      ? [process.execPath, path.join(import.meta.dirname, "integration.mjs")]
      : args;
  const child = spawn(childArgs[0], childArgs.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENMELD_PG_ISOLATED: "1",
      OPENMELD_PG_BIN: bin,
      POSTGRESQL_OPENMELD_MIGRATION_URL: owner,
      POSTGRESQL_OPENMELD_RUNTIME_URL: owner.replace(
        "openmeld_pg_owner:",
        "openmeld_pg_runtime:"
      ),
      POSTGRESQL_OPENMELD_RUNTIME_ROLE: "openmeld_pg_runtime",
    },
  });
  const forward = (signal) => child.kill(signal);
  const stopInt = () => forward("SIGINT");
  const stopTerm = () => forward("SIGTERM");
  process.on("SIGINT", stopInt);
  process.on("SIGTERM", stopTerm);
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.off("SIGINT", stopInt);
  process.off("SIGTERM", stopTerm);
  process.exitCode = status;
} finally {
  if (started) {
    run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  }
  // Only this process's freshly-created temporary cluster is reset/removed.
  await rm(root, { recursive: true });
}
