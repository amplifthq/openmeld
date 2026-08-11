import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveAgentProfileControllerModelDetail } from "./agent-profile-model-display";

describe("resolveAgentProfileControllerModelDetail", () => {
	it("shows the selected model and selected reasoning effort", () => {
		expect(
			resolveAgentProfileControllerModelDetail({
				agentControllerRef: "builtin:codex",
				controllerDisplayName: "Codex",
				modelCatalog: buildModelCatalog(),
				modelSelection: {
					modelId: "gpt-5.3-codex-spark",
					reasoningLevel: "high",
				},
			})
		).toBe("Codex · gpt-5.3-codex-spark · high");
	});

	it("shows model default when the model is explicit and reasoning effort is not", () => {
		expect(
			resolveAgentProfileControllerModelDetail({
				agentControllerRef: "builtin:codex",
				controllerDisplayName: "Codex",
				modelCatalog: buildModelCatalog(),
				modelSelection: {
					modelId: "gpt-5.4",
				},
			})
		).toBe("Codex · gpt-5.4 · model default");
	});

	it("shows the controller default model when no model is explicit", () => {
		expect(
			resolveAgentProfileControllerModelDetail({
				agentControllerRef: "builtin:codex",
				controllerDisplayName: "Codex",
				modelCatalog: buildModelCatalog(),
				modelSelection: null,
			})
		).toBe("Codex · gpt-5.5 · model default");
	});

	it("does not invent reasoning effort for models without reasoning support", () => {
		expect(
			resolveAgentProfileControllerModelDetail({
				agentControllerRef: "builtin:claude-code",
				controllerDisplayName: "Claude Code",
				modelCatalog: buildModelCatalog(),
				modelSelection: {
					modelId: "claude-haiku-4-5",
				},
			})
		).toBe("Claude Code · claude-haiku-4-5");
	});
});

function buildModelCatalog(): ModelCatalog {
	return {
		agentControllers: {
			"claude-code": {
				defaultModelId: "claude-opus-4-8",
				models: [
					{
						displayName: "Claude Opus 4.8",
						id: "claude-opus-4-8",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
					{
						displayName: "Claude Haiku 4.5",
						id: "claude-haiku-4-5",
						minCliVersion: null,
						supportedReasoningLevels: [],
						unavailable: false,
					},
				],
			},
			codex: {
				defaultModelId: "gpt-5.5",
				models: [
					{
						displayName: "GPT-5.5",
						id: "gpt-5.5",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
					{
						displayName: "GPT-5.4",
						id: "gpt-5.4",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
					{
						displayName: "GPT-5.3 Codex Spark",
						id: "gpt-5.3-codex-spark",
						minCliVersion: null,
						supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
						unavailable: false,
					},
				],
			},
		},
		schemaVersion: 1,
		updatedAt: "2026-06-18T00:00:00.000Z",
	};
}
