import type { ModelCatalog, ModelCatalogModel } from "@openmeld/schemas/types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileModelSelectionFields } from "./create-profile-form";
import {
	resolveModelCompatibility,
	resolveModelRetirementDisplay,
} from "./create-profile-form-logic";

const WITHDRAWAL_COPY = /No longer offered with ChatGPT sign-in/;
const oldModel: ModelCatalogModel = {
	id: "old-model",
	displayName: "Original model",
	unavailable: false,
	supportedReasoningLevels: [],
	minCliVersion: null,
	retirement: {
		status: "withdrawn",
		date: { value: "2000-01-01", kind: "on" },
		scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
		sourceUrl: "https://example.com/official-notice",
		verifiedAt: "2026-09-23T00:00:00Z",
	},
};
const catalog: ModelCatalog = {
	schemaVersion: 1,
	updatedAt: "2026-09-23T00:00:00Z",
	agentControllers: {
		codex: {
			defaultModelId: "replacement",
			models: [
				oldModel,
				{
					...oldModel,
					id: "replacement",
					displayName: "Replacement",
					retirement: undefined,
				},
			],
		},
	},
};
const context = {
	agentControllerId: "codex",
	agentControllerRef: "builtin:codex",
	authType: "chatgpt",
	controllerDisplayName: "Codex",
	managePath: "/o/test/computers",
	installedVersion: null,
	reportedModelIds: ["old-model", "replacement"],
};
afterEach(cleanup);

describe("reviewed retirement in the model editor", () => {
	it("keeps the user's original value and gives a source without choosing a replacement", () => {
		const onChangeModelId = vi.fn();
		render(
			<AgentProfileModelSelectionFields
				agentId="codex"
				disabled={false}
				modelCatalog={catalog}
				modelCompatibilityContext={context}
				modelId="old-model"
				onChangeModelId={onChangeModelId}
				onChangeReasoningLevel={vi.fn()}
				reasoningLevel=""
			/>
		);
		expect(screen.getByText("Original model")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Official notice" }).getAttribute("href")
		).toBe("https://example.com/official-notice");
		expect(screen.getByText(WITHDRAWAL_COPY)).toBeTruthy();
		expect(onChangeModelId).not.toHaveBeenCalled();
	});
	it.each([
		"apiKey",
		undefined,
	])("does not reject a scoped withdrawal with %s evidence", (authType) => {
		const result = resolveModelCompatibility({
			controller: catalog.agentControllers.codex ?? null,
			context: { ...context, authType },
			modelId: "old-model",
		});
		expect(result.knownIncompatible).toBe(false);
		if (authType) {
			expect(
				resolveModelRetirementDisplay(oldModel, { ...context, authType })
			).toBeNull();
		}
	});
	it("does not reject an announced date in the past", () => {
		const controller = {
			defaultModelId: oldModel.id,
			models: [
				{
					...oldModel,
					retirement: {
						status: "announced" as const,
						date: { value: "2000-01-01", kind: "on" as const },
						scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
						sourceUrl: "https://example.com/official-notice",
						verifiedAt: "2026-09-23T00:00:00Z",
					},
				},
			],
		};
		expect(
			resolveModelCompatibility({ controller, context, modelId: oldModel.id })
				.knownIncompatible
		).toBe(false);
	});
});
