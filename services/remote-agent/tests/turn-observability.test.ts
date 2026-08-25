import { describe, expect, it } from "vitest";
import {
  readRemoteAgentTurnObservability,
  recordRemoteAgentTurnObservability,
} from "../agent-core/turn-observability";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Remote Agent turn observability", () => {
  it("keeps first milestones, latest tool exposure, and bounded structured decisions", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const submissionId = "submission-1";
    const base = Date.now();

    await recordRemoteAgentTurnObservability({
      event: {
        availableToolCount: 80,
        exposedToolCount: 12,
        modelId: "openai/gpt-5.4",
        observedAtMs: base + 105,
        type: "provider_request_prepared",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        availableToolCount: 82,
        exposedToolCount: 10,
        modelId: "openai/gpt-5.4",
        observedAtMs: base + 115,
        type: "provider_request_prepared",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        modelId: "openai/gpt-5.4",
        observedAtMs: base + 108,
        type: "provider_response_headers",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        assistantText: false,
        observedAtMs: base + 110,
        type: "model_event",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        assistantText: true,
        observedAtMs: base + 120,
        type: "model_event",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        capabilityNames: ["openmeld_read_center_agent_turn_diagnostics"],
        observedAtMs: base + 125,
        operation: "search",
        resultCount: 1,
        type: "capability_discovery",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: {
        observedAtMs: base + 130,
        source: "code_mode",
        toolName: "openmeld_read_center_agent_turn_diagnostics",
        type: "tool_call",
      },
      storage,
      submissionId,
    });
    await recordRemoteAgentTurnObservability({
      event: { observedAtMs: base + 180, type: "model_completed" },
      storage,
      submissionId,
    });

    await expect(
      readRemoteAgentTurnObservability({ storage, submissionId })
    ).resolves.toMatchObject({
      capabilitySearchCount: 1,
      codeModeToolCallCount: 1,
      directToolCallCount: 0,
      firstAssistantTextAtMs: base + 120,
      firstModelEventAtMs: base + 110,
      firstProviderRequestPreparedAtMs: base + 105,
      firstProviderResponseHeadersAtMs: base + 108,
      lastModelCompletedAtMs: base + 180,
      modelCallCount: 1,
      modelId: "openai/gpt-5.4",
      providerAvailableToolCount: 82,
      providerDeferredToolCount: 72,
      providerExposedToolCount: 10,
      providerRequestCount: 2,
      recentCapabilityDiscovery: [
        {
          capabilityNames: ["openmeld_read_center_agent_turn_diagnostics"],
          observedAtMs: base + 125,
          operation: "search",
          resultCount: 1,
        },
      ],
      recentProviderRequests: [
        {
          availableToolCount: 80,
          deferredToolCount: 68,
          exposedToolCount: 12,
          modelId: "openai/gpt-5.4",
          preparedAtMs: base + 105,
        },
        {
          availableToolCount: 82,
          deferredToolCount: 72,
          exposedToolCount: 10,
          modelId: "openai/gpt-5.4",
          preparedAtMs: base + 115,
        },
      ],
      toolCallCount: 1,
      toolCallLimit: 64,
    });
  });

  it("records budget exhaustion without treating model prose as evidence", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const observedAtMs = Date.now();

    await recordRemoteAgentTurnObservability({
      event: { observedAtMs, type: "tool_budget_exhausted" },
      storage,
      submissionId: "submission-budget",
    });

    await expect(
      readRemoteAgentTurnObservability({
        storage,
        submissionId: "submission-budget",
      })
    ).resolves.toMatchObject({
      budgetExhaustedAtMs: observedAtMs,
      toolCallCount: 0,
    });
  });

  it("claims each first milestone once when events share a timestamp", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const observedAtMs = Date.now();
    const submissionId = "submission-first-milestones";

    const firstModelEvent = await recordRemoteAgentTurnObservability({
      event: {
        assistantText: false,
        observedAtMs,
        type: "model_event",
      },
      storage,
      submissionId,
    });
    const firstAssistantText = await recordRemoteAgentTurnObservability({
      event: {
        assistantText: true,
        observedAtMs,
        type: "model_event",
      },
      storage,
      submissionId,
    });
    const repeatedAssistantText = await recordRemoteAgentTurnObservability({
      event: {
        assistantText: true,
        observedAtMs,
        type: "model_event",
      },
      storage,
      submissionId,
    });

    expect(firstModelEvent).toMatchObject({
      firstAssistantTextRecorded: false,
      firstModelEventRecorded: true,
    });
    expect(firstAssistantText).toMatchObject({
      firstAssistantTextRecorded: true,
      firstModelEventRecorded: false,
    });
    expect(repeatedAssistantText).toMatchObject({
      firstAssistantTextRecorded: false,
      firstModelEventRecorded: false,
    });
  });
});
