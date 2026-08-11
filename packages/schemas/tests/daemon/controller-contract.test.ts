import { describe, expect, it } from "vitest";
import {
  agentContextResolutionSchema,
  runtimeAgentControllerLaunchCandidateSchema,
  runtimeAgentControllerLaunchContractSchema,
  runtimeAgentControllerSettingsSchema,
} from "../../src/index";

describe("daemon controller contract schema", () => {
  it("accepts controller settings with defaults", () => {
    const result = runtimeAgentControllerSettingsSchema.safeParse({
      transport_mode: "local-cli",
      context_id_mapping_spec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.dispatch_policy).toBe("mention_only");
    expect(result.data.streaming_mode).toBe("final");
    expect(result.data.timeout_ms).toBeNull();
    expect(result.data.retry).toBe(0);
  });

  it("accepts controller settings for Codex App Server transport", () => {
    const result = runtimeAgentControllerSettingsSchema.safeParse({
      transport_mode: "codex-app-server",
      context_id_mapping_spec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported transport mode", () => {
    const result = runtimeAgentControllerSettingsSchema.safeParse({
      dispatch_policy: "mention_only",
      transport_mode: "http",
      timeout_ms: 120_000,
      retry: 0,
      context_id_mapping_spec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid mapping version boundary", () => {
    const result = runtimeAgentControllerSettingsSchema.safeParse({
      dispatch_policy: "mention_only",
      transport_mode: "local-cli",
      timeout_ms: 120_000,
      retry: 0,
      context_id_mapping_spec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported streaming mode", () => {
    const result = runtimeAgentControllerSettingsSchema.safeParse({
      dispatch_policy: "mention_only",
      transport_mode: "local-cli",
      streaming_mode: "chunk",
      timeout_ms: 120_000,
      retry: 0,
      context_id_mapping_spec: {
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts agent context resolution with nullable id", () => {
    const result = agentContextResolutionSchema.safeParse({
      agentControllerConversationId: null,
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      mappingVersion: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts agent context resolution with typed agent controller conversation", () => {
    const result = agentContextResolutionSchema.safeParse({
      agentControllerConversationId: "thread-1",
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      mappingVersion: 1,
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "thread-1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts node-script launch contracts", () => {
    const result = runtimeAgentControllerLaunchContractSchema.safeParse({
      kind: "node_script",
      nodePath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/node",
      scriptPath:
        "/Users/demo/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/openclaw.mjs",
    });
    expect(result.success).toBe(true);
  });

  it("accepts launch candidates with display metadata", () => {
    const result = runtimeAgentControllerLaunchCandidateSchema.safeParse({
      installId: "install_a1b2c3d4",
      label: "nvm install",
      detail: "Node 24.14.0",
      commandPath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/openclaw",
      launchContract: {
        kind: "node_script",
        nodePath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/node",
        scriptPath:
          "/Users/demo/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/openclaw.mjs",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects launch candidates without install metadata", () => {
    const result = runtimeAgentControllerLaunchCandidateSchema.safeParse({
      installId: "",
      label: "nvm install",
      detail: "Node 24.14.0",
      commandPath: "/tmp/openclaw",
      launchContract: {
        kind: "executable",
        commandPath: "/tmp/openclaw",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects executable launch contracts without a commandPath", () => {
    const result = runtimeAgentControllerLaunchContractSchema.safeParse({
      kind: "executable",
    });
    expect(result.success).toBe(false);
  });
});
