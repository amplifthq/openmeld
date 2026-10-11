import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MEMORY = 6 * 1024 ** 3;
const OOM = /^oom (\d+)$/m;
const OOM_KILL = /^oom_kill (\d+)$/m;

// Warm an empty owned container, install limits, then admit workload requests.
// Repeat the gate after each deliberate restart. Startup is measured separately.
export function resourceMonitor(reportPath, workerName) {
  const containers = new Map();
  async function sample(id, record) {
    const { stdout } = await exec("docker", ["inspect", id], { timeout: 5000 });
    const state = JSON.parse(stdout)[0];
    record.oomKilled ||= state.State.OOMKilled;
    record.limits = {
      memory: state.HostConfig.Memory,
      swap: state.HostConfig.MemorySwap,
      nanoCpus: state.HostConfig.NanoCpus,
    };
    assert(
      record.limits.memory === MEMORY &&
        record.limits.swap === MEMORY &&
        record.limits.nanoCpus === 1_000_000_000,
      "Resource limits differ"
    );
    assert(
      state.State.Running,
      "Owned container stopped before telemetry checkpoint"
    );
    const { stdout: cg } = await exec(
      "docker",
      [
        "exec",
        id,
        "python3",
        "-c",
        "import pathlib,json; print(json.dumps({n:(pathlib.Path('/sys/fs/cgroup')/n).read_text().strip() for n in ['memory.peak','memory.events','cpu.max','memory.max','memory.swap.max','cpu.stat']}))",
      ],
      { timeout: 5000 }
    );
    record.samples++;
    const values = JSON.parse(cg);
    const [quota, period] = values["cpu.max"].split(" ").map(Number);
    assert(
      Number.isFinite(quota) && quota > 0 && quota === period,
      "Kernel CPU quota differs"
    );
    assert(
      Number(values["memory.max"]) === MEMORY &&
        values["memory.swap.max"] === "0",
      "Kernel memory limits differ"
    );
    const peak = Number(values["memory.peak"]);
    const oom = Number(values["memory.events"].match(OOM)?.[1]);
    const kills = Number(values["memory.events"].match(OOM_KILL)?.[1]);
    assert(
      [peak, oom, kills].every(Number.isFinite),
      "Missing kernel memory evidence"
    );
    record.cgroup = values;
    record.peakMemory = Math.max(record.peakMemory, peak);
    record.oomEvents = Math.max(record.oomEvents, oom);
    record.oomKills = Math.max(record.oomKills, kills);
  }
  let pending = Promise.resolve();
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    pending = Promise.all(
      [...containers].map(async ([id, record]) => {
        if (record.retired) {
          return;
        }
        try {
          await sample(id, record);
        } catch (error) {
          record.lastSamplingError = String(error);
          record.samplingErrors = (record.samplingErrors ?? 0) + 1;
        }
      })
    ).finally(() => {
      busy = false;
    });
  }, 1000);
  return {
    async checkpoint() {
      await pending;
      busy = true;
      try {
        for (const [id, record] of containers) {
          if (record.retired) {
            continue;
          }
          await sample(id, record);
          record.retired = true;
        }
      } finally {
        busy = false;
      }
    },
    async gate() {
      const { stdout } = await exec("docker", ["ps", "--format", "{{json .}}"]);
      const owned = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((row) => JSON.parse(row))
        .filter(
          (row) =>
            row.Names.includes(workerName) &&
            !row.Image.includes("proxy-everything")
        );
      assert(
        owned.length === 1,
        `Expected one owned native container: ${JSON.stringify(owned)}`
      );
      for (const row of owned) {
        if (!containers.has(row.ID)) {
          await exec("docker", [
            "update",
            "--memory",
            String(MEMORY),
            "--memory-swap",
            String(MEMORY),
            "--cpus",
            "1",
            row.ID,
          ]);
          containers.set(row.ID, {
            name: row.Names,
            samples: 0,
            peakMemory: 0,
            oomKilled: false,
            oomEvents: 0,
            oomKills: 0,
          });
        }
        await sample(row.ID, containers.get(row.ID));
      }
    },
    async close() {
      clearInterval(timer);
      await pending;
      const report = {
        memoryBytes: MEMORY,
        vcpu: 1,
        swapBytes: 0,
        limitsAppliedAfterWarmup: true,
        peakIncludesStartup: true,
        containers: Object.fromEntries(containers),
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      assert(
        containers.size >= 5,
        "Initial instance plus four replacements required"
      );
      for (const record of containers.values()) {
        assert(
          record.samples > 0 && record.cgroup,
          "Missing enforced-limit telemetry"
        );
        assert(
          record.retired && !record.samplingErrors,
          "Incomplete lifetime resource evidence"
        );
        assert(
          !(record.oomKilled || record.oomEvents || record.oomKills),
          "Container OOM observed"
        );
      }
      return report;
    },
  };
}
