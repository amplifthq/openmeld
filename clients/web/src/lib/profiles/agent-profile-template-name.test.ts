import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	buildAgentProfileTemplateName,
	formatAgentProfileReasoningLevel,
	resolveUniqueAgentProfileName,
} from "./agent-profile-template-name";

const MODEL_CATALOG = {
	schemaVersion: 1,
	updatedAt: "2026-09-01T00:00:00.000Z",
	agentControllers: {
		codex: {
			defaultModelId: "gpt-5.6-sol",
			models: [
				{
					displayName: "GPT-5.6 Sol",
					id: "gpt-5.6-sol",
					supportedReasoningLevels: ["low", "high", "xhigh"],
					unavailable: false,
					minCliVersion: null,
				},
			],
		},
	},
} satisfies ModelCatalog;

describe("buildAgentProfileTemplateName", () => {
	it("builds a compact factual name without possessives or separators", () => {
		expect(
			buildAgentProfileTemplateName({
				agentId: "codex",
				existingNames: [],
				localAgentDisplayName: "Codex",
				modelCatalog: MODEL_CATALOG,
				modelId: "",
				ownerDisplayName: "Felix Lu",
				reasoningLevel: "xhigh",
			})
		).toBe("Felix Lu Codex GPT-5.6 Sol Xhigh");
	});

	it("uses the selected model and naturally suffixes duplicate names", () => {
		expect(
			buildAgentProfileTemplateName({
				agentId: "codex",
				existingNames: [
					"Felix Codex GPT-5.6 Sol High",
					"Felix Codex GPT-5.6 Sol High (1)",
				],
				localAgentDisplayName: "Codex",
				modelCatalog: MODEL_CATALOG,
				modelId: "gpt-5.6-sol",
				ownerDisplayName: "Felix",
				reasoningLevel: "high",
			})
		).toBe("Felix Codex GPT-5.6 Sol High (2)");
	});
});

describe("resolveUniqueAgentProfileName", () => {
	it("compares names case-insensitively and uses the first open suffix", () => {
		expect(
			resolveUniqueAgentProfileName({
				baseName: "Felix Codex",
				existingNames: ["felix codex", "Felix Codex (1)", "Felix Codex (3)"],
			})
		).toBe("Felix Codex (2)");
	});
});

describe("formatAgentProfileReasoningLevel", () => {
	it("turns controller identifiers into readable name parts", () => {
		expect(formatAgentProfileReasoningLevel("extra_high")).toBe("Extra High");
		expect(formatAgentProfileReasoningLevel("")).toBeNull();
	});
});
