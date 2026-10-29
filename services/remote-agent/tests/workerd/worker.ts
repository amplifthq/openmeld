import { DurableObject, RpcTarget } from "cloudflare:workers";
import { Agent } from "agents";
import { readRemoteAgentRuntimeDiagnostics } from "../../flue-adapter/runtime-diagnostics";

// biome-ignore lint/performance/noBarrelFile: Workerd test entrypoint exposes the production Computer owner.
export { AgentComputer } from "../../flue-adapter/computer-workspace";

import {
  ACCOUNT_ERASED_KEY,
  eraseAccountStorage,
  requireRetainedAccountStorage,
} from "../../flue-adapter/account-deletion";

export class ComputerCommandProbe extends DurableObject {}

export class ScheduleDiagnosticProbe extends Agent {
  async retryCallback() {
    // The test inspects the future schedule without executing it.
  }

  async inspect() {
    const schedule = await this.schedule(3600.5, "retryCallback", {
      secret: "private",
    });
    const diagnostics = await readRemoteAgentRuntimeDiagnostics({
      getAlarmAtMs: () => this.ctx.storage.getAlarm(),
      listSchedules: () => this.listSchedules(),
      nowMs: 1000,
      spaceId: "space-1",
      sql: {
        exec: (query, ...bindings) =>
          query.includes("flue_agent_submissions") ||
          query.includes("openmeld_remote_agent_adapter_kv")
            ? { toArray: () => [] }
            : this.ctx.storage.sql.exec(query, ...bindings),
      },
    });
    return {
      schedule,
      diagnostics,
      legacyTableCount: this.ctx.storage.sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cf_agents_schedules'"
        )
        .toArray().length,
    };
  }
}

class PrivateContentCapability extends RpcTarget {
  read() {
    return "private cached content";
  }
}
export class AccountErasureProbe extends DurableObject {
  async seed() {
    await requireRetainedAccountStorage(this.ctx.storage);
    await this.ctx.storage.put("private", "private persisted content");
    return new PrivateContentCapability();
  }
  async erase() {
    if (await this.ctx.storage.get(ACCOUNT_ERASED_KEY)) {
      return;
    }
    await eraseAccountStorage(this.ctx);
  }
  async inspect() {
    return {
      erased: await this.ctx.storage.get(ACCOUNT_ERASED_KEY),
      content: (await this.ctx.storage.get("private")) ?? null,
    };
  }
}
