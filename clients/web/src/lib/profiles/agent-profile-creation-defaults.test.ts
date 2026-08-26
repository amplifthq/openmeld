import type {
	GetAgentProfileCreationDefaultsResponse,
	ModelCatalog,
	Project,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveRememberedAgentProfileCreationDefaults } from "./agent-profile-creation-defaults";

describe("remembered Agent Profile creation defaults", () => {
	it("restores only values that still belong to the selected Local Agent and Organization", () => {
		expect(
			resolveRememberedAgentProfileCreationDefaults({
				agentId: "codex",
				defaults: defaults(),
				modelCatalog: modelCatalog(),
				projects: [project()],
			})
		).toEqual({
			agentControllerPermissionMode: "codex:fullAccess",
			defaultProjectId: "project-1",
			modelId: "gpt-5.6-sol",
			openCodePermission: null,
			reasoningLevel: "max",
		});
	});

	it("drops stale Project, model, reasoning, and cross-controller permissions", () => {
		expect(
			resolveRememberedAgentProfileCreationDefaults({
				agentId: "claude-code",
				defaults: defaults(),
				modelCatalog: modelCatalog(),
				projects: [project()],
			})
		).toEqual({
			agentControllerPermissionMode: "claude-code:default",
			defaultProjectId: null,
			modelId: null,
			openCodePermission: null,
			reasoningLevel: null,
		});
	});
});

function defaults(): GetAgentProfileCreationDefaultsResponse {
	return {
		agentControllerCollaborationMode: "codex:plan",
		agentControllerPermissionMode: "codex:fullAccess",
		agentControllerRef: "builtin:codex",
		defaultProjectId: "project-1",
		modelId: "gpt-5.6-sol",
		openCodePermission: null,
		organizationId: "org-1",
		reasoningLevel: "max",
		updatedAt: "2026-08-18T12:00:00.000Z",
		userId: "user-1",
	};
}

function modelCatalog(): ModelCatalog {
	return {
		agentControllers: {
			"claude-code": {
				defaultModelId: "claude-opus-4-8",
				models: [
					{
						displayName: "Claude Opus 4.8",
						id: "claude-opus-4-8",
						minCliVersion: null,
						supportedReasoningLevels: ["high"],
						unavailable: false,
					},
				],
			},
			codex: {
				defaultModelId: "gpt-5.6-sol",
				models: [
					{
						displayName: "GPT-5.6 Sol",
						id: "gpt-5.6-sol",
						minCliVersion: null,
						supportedReasoningLevels: ["high", "max"],
						unavailable: false,
					},
				],
			},
		},
		schemaVersion: 1,
		updatedAt: "2026-08-18T00:00:00.000Z",
	};
}

function project(): Project {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-1",
		id: "project-1",
		name: "OpenMeld",
		organizationId: "org-1",
		repositoryFingerprint: null,
		repositoryUrl: null,
		slug: "openmeld",
		updatedAtMs: 1,
	};
}
