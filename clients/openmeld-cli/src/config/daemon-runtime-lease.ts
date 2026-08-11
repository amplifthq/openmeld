import { rm } from "node:fs/promises";
import { join } from "node:path";
import { daemonRuntimeLeaseSchema } from "@openmeld/schemas";
import type { DaemonRuntimeLease } from "@openmeld/schemas/types";
import {
  readDaemonLocalStateFile,
  writeDaemonLocalStateFile,
} from "./daemon-local-state-file";
import { daemonRuntimeStateRootPath } from "./daemon-state";
import type { OpenMeldPathResolutionInput } from "./paths";

const DAEMON_RUNTIME_LEASE_FILENAME = "runtime-lease.json";

export function daemonRuntimeLeasePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    DAEMON_RUNTIME_LEASE_FILENAME
  );
}

export async function readDaemonRuntimeLease(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonRuntimeLease | null> {
  return await readDaemonLocalStateFile({
    path: daemonRuntimeLeasePath(pathInput),
    schema: daemonRuntimeLeaseSchema,
  });
}

export async function writeDaemonRuntimeLease(
  lease: DaemonRuntimeLease,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeDaemonLocalStateFile({
    path: daemonRuntimeLeasePath(pathInput),
    schema: daemonRuntimeLeaseSchema,
    value: lease,
    mode: 0o600,
  });
}

export async function clearDaemonRuntimeLease(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await rm(daemonRuntimeLeasePath(pathInput), { force: true });
}
