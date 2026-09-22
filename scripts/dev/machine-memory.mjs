import { execFileSync } from "node:child_process";
import { totalmem } from "node:os";

const PAGE_SIZE = /page size of (\d+) bytes/u;
const PAGE_COUNT =
  /^(Pages free|Pages inactive|Pages speculative):\s+(\d+)\./gmu;
const SWAPOUTS = /^Swapouts:\s+(\d+)\./mu;

export function parseMacMemory(output, pressure, totalBytes) {
  const pageSize = Number(PAGE_SIZE.exec(output)?.[1]);
  const counts = [...output.matchAll(PAGE_COUNT)];
  if (!pageSize || counts.length !== 3 || ![1, 2, 4].includes(pressure)) {
    throw new Error("Unable to read macOS memory statistics.");
  }
  return {
    totalBytes,
    availableBytes: Math.min(
      totalBytes,
      counts.reduce((sum, match) => sum + Number(match[2]), 0) * pageSize
    ),
    pressure: { 1: "normal", 2: "warning", 4: "critical" }[pressure],
    swapouts: SWAPOUTS.test(output) ? Number(SWAPOUTS.exec(output)[1]) : null,
    source: "macOS free + inactive + speculative pages (estimate)",
  };
}

export function effectiveTotalMemory(systemBytes, constrainedBytes) {
  // libuv can report UINT64_MAX for an unconstrained Linux process. A process
  // constraint can reduce usable RAM, never increase physical machine memory.
  return Math.min(systemBytes, constrainedBytes || systemBytes);
}

export function readMachineMemory() {
  const totalBytes = effectiveTotalMemory(
    totalmem(),
    process.constrainedMemory()
  );
  if (process.platform === "darwin") {
    // libuv 1.51's Darwin implementation reports free pages only. Include
    // reclaimable pages, and independently respect operating-system pressure.
    const options = {
      encoding: "utf8",
      timeout: 3000,
      env: { ...process.env, LC_ALL: "C" },
    };
    return parseMacMemory(
      execFileSync("vm_stat", [], options),
      Number(
        execFileSync(
          "sysctl",
          ["-n", "kern.memorystatus_vm_pressure_level"],
          options
        ).trim()
      ),
      totalBytes
    );
  }
  return {
    totalBytes,
    availableBytes: process.availableMemory(),
    pressure: "unknown",
    source:
      "Node/libuv available memory (includes effective process constraints)",
  };
}
