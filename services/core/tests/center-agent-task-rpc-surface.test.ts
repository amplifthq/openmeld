import { describe, expect, it } from "vitest";
import { CenterAgentRpcEntrypoint, GatewayRpcEntrypoint } from "../src/index";

const WEB_TASK_METHODS = [
  "listCenterAgentTasks",
  "getCenterAgentTask",
  "continueCenterAgentTask",
  "stopCenterAgentTask",
  "retryCenterAgentTask",
] as const;
const MODEL_TASK_METHODS = [
  "centerAgentCreateTask",
  "centerAgentListTasks",
  "centerAgentGetTask",
] as const;

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

  it("keeps model-only Task methods off the Gateway RPC surface", () => {
    const centerAgentMethods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );
    const gatewayMethods = Object.getOwnPropertyNames(
      GatewayRpcEntrypoint.prototype
    );
    for (const method of MODEL_TASK_METHODS) {
      expect(centerAgentMethods).toContain(method);
      expect(gatewayMethods).not.toContain(method);
    }
  });
});
