import { describe, expect, it, vi } from "vitest";
import {
	buildAgentProfileCreationJourneyDraftStorageKey,
	readAgentProfileCreationJourneyDraft,
	writeAgentProfileCreationJourneyDraft,
} from "./agent-profile-creation-journey-draft";

describe("Agent Profile creation journey draft", () => {
	it("scopes a draft to the current user and Organization", () => {
		expect(
			buildAgentProfileCreationJourneyDraftStorageKey({
				organizationId: "org-1",
				userId: "user-1",
			})
		).toBe("openmeld:agent-profile-creation-journey:org-1:user-1");
	});

	it("round-trips only the non-sensitive setup choices", () => {
		let saved: string | null = null;
		const storage = {
			getItem: vi.fn(() => saved),
			removeItem: vi.fn(),
			setItem: vi.fn((_key: string, value: string) => {
				saved = value;
			}),
		};
		const draft = {
			agentControllerCollaborationMode: "codex:default" as const,
			agentControllerPermissionMode: "codex:askForApproval" as const,
			agentId: "codex",
			modelId: "gpt-5.6-sol",
			openCodePermission: null,
			reasoningLevel: "high",
			selectedProjectId: "project-1",
			version: 1 as const,
		};

		writeAgentProfileCreationJourneyDraft({
			draft,
			key: "draft-key",
			storage,
		});

		expect(
			readAgentProfileCreationJourneyDraft({ key: "draft-key", storage })
		).toEqual(draft);
		expect(saved).not.toContain("/Users/felix");
	});

	it("drops an invalid draft instead of guessing at stale choices", () => {
		const storage = {
			getItem: vi.fn(() => '{"version":1,"agentId":42}'),
			removeItem: vi.fn(),
		};

		expect(
			readAgentProfileCreationJourneyDraft({ key: "draft-key", storage })
		).toBeNull();
		expect(storage.removeItem).toHaveBeenCalledWith("draft-key");
	});
});
