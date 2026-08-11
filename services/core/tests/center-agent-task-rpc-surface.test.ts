import { describe, expect, it } from "vitest";
import { CenterAgentRpcEntrypoint, GatewayRpcEntrypoint } from "../src/index";

const WEB_TASK_METHODS = [
  "listCenterAgentTasks",
  "getCenterAgentTask",
  "continueCenterAgentTask",
  "stopCenterAgentTask",
  "retryCenterAgentTask",
] as const;
const MODEL_CREATE_METHOD = "centerAgentCreateTask";

describe("Center Agent Task RPC surface", () => {
  it("exposes requester Task reads and mutations through Gateway RPC", () => {
    const gatewayMethods = Object.getOwnPropertyNames(
      GatewayRpcEntrypoint.prototype
    );
    const centerAgentMethods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );
    for (const method of WEB_TASK_METHODS) {
      expect(gatewayMethods).toContain(method);
      expect(centerAgentMethods).toContain(method);
    }
  });

  it("keeps model-only Task creation off the Gateway RPC surface", () => {
    expect(
      Object.getOwnPropertyNames(CenterAgentRpcEntrypoint.prototype)
    ).toContain(MODEL_CREATE_METHOD);
    expect(
      Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype)
    ).not.toContain(MODEL_CREATE_METHOD);
  });
});
