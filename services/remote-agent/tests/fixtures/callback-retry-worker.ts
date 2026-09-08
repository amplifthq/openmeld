import { Agent, getAgentByName } from "agents";
import { scheduleRemoteAgentCallbackRetry } from "../../flue-adapter/center-agent-admission";

type Env = Cloudflare.Env & {
  CALLBACKS: DurableObjectNamespace<CallbackRetryProbe>;
};

export class CallbackRetryProbe extends Agent<Env> {
  async retryRemoteAgentCallbacks() {
    const attempts =
      ((await this.ctx.storage.get<number>("attempts")) ?? 0) + 1;
    await this.ctx.storage.put("attempts", attempts);
    // Two transient delivery failures, followed by a successful third attempt.
    if (attempts < 3) {
      await scheduleRemoteAgentCallbackRetry({
        dueAtIso: new Date(Date.now() + 1000).toISOString(),
        schedule: this.schedule.bind(this),
      });
    }
  }

  async onRequest(request: Request) {
    if (request.method === "POST") {
      const dueAtIso = new Date(Date.now() + 1000).toISOString();
      for (let i = 0; i < 4; i += 1) {
        await scheduleRemoteAgentCallbackRetry({
          dueAtIso,
          schedule: this.schedule.bind(this),
        });
      }
    }
    return Response.json({
      attempts: (await this.ctx.storage.get<number>("attempts")) ?? 0,
      schedules: this.getSchedules().length,
    });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const agent = await getAgentByName(env.CALLBACKS, "retry-probe");
    return agent.fetch(request);
  },
};
