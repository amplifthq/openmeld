import { DurableObject, RpcTarget } from "cloudflare:workers";

// biome-ignore lint/performance/noBarrelFile: Workerd test entrypoint exposes the production Computer owner.
export { AgentComputer } from "../../flue-adapter/computer-workspace";

import {
  ACCOUNT_ERASED_KEY,
  eraseAccountStorage,
  requireRetainedAccountStorage,
} from "../../flue-adapter/account-deletion";

export class ComputerCommandProbe extends DurableObject {}

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
