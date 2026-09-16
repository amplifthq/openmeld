import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configureWorkspaceMock = vi.hoisted(() => vi.fn());

vi.mock("./create-profile-flow", () => ({
	configureNewAgentProfileWorkspace: configureWorkspaceMock,
}));

import {
	clearPendingAgentProfileCreationLocalSetupForProfile,
	continuePendingAgentProfileCreationLocalSetup,
	readPendingAgentProfileCreationLocalSetup,
	rememberPendingAgentProfileCreationLocalSetup,
	transferPendingAgentProfileCreationLocalSetup,
} from "./agent-profile-creation-local-setup";

describe("pending Agent Profile creation local setup", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		configureWorkspaceMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		"computer-1",
		"computer-2",
	])("carries custom-folder intent into recovery on %s without copying private paths to another computer", (computerId) => {
		const source = {
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
		};
		rememberPendingAgentProfileCreationLocalSetup({
			...source,
			agentProfileId: null,
			workspacePath: "/private/project",
		});
		const fromRequest = requestFixture({
			status: "failed",
			createdAgentProfileId: null,
		});
		const toRequest = {
			...fromRequest,
			id: "replacement",
			configuration: {
				...fromRequest.configuration,
				targetComputerId: computerId,
			},
		};
		expect(
			transferPendingAgentProfileCreationLocalSetup({
				fromRequest,
				toRequest,
				storageScope: source.storageScope,
			})
		).toBe(true);
		expect(
			readPendingAgentProfileCreationLocalSetup({
				...source,
				requestId: toRequest.id,
			})
		).toEqual({
			agentProfileId: null,
			workspacePath: computerId === "computer-1" ? "/private/project" : null,
		});
		expect(readPendingAgentProfileCreationLocalSetup(source)).toBeNull();
		window.sessionStorage.clear();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				...source,
				requestId: toRequest.id,
			})
		).toEqual({ agentProfileId: null, workspacePath: null });
	});

	it("keeps setup incomplete without persisting the private path after the tab closes", async () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: AGENT_PROFILE_ID,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
		window.sessionStorage.clear();

		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({ agentProfileId: AGENT_PROFILE_ID, workspacePath: null });
		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "completed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({
			failureMessage:
				"Choose the custom working folder again in Agent settings on this computer.",
			pending: true,
		});
		expect(configureWorkspaceMock).not.toHaveBeenCalled();
	});

	it("falls back to the non-path marker when per-tab storage is unavailable", () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: AGENT_PROFILE_ID,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
		const originalGetItem = Storage.prototype.getItem;
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
			this: Storage,
			key: string
		) {
			if (this === window.sessionStorage) {
				throw new DOMException("Storage is unavailable", "SecurityError");
			}
			return originalGetItem.call(this, key);
		});

		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({ agentProfileId: AGENT_PROFILE_ID, workspacePath: null });
	});

	it("clears every saved setup intent for the Profile after settings finishes it", () => {
		for (const requestId of ["request-1", "request-2"]) {
			rememberPendingAgentProfileCreationLocalSetup({
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-1",
				requestId,
				storageScope: "account-1",
				workspacePath: "/Users/felix/Desktop/work/openmeld",
			});
		}

		clearPendingAgentProfileCreationLocalSetupForProfile(AGENT_PROFILE_ID);

		for (const requestId of ["request-1", "request-2"]) {
			expect(
				readPendingAgentProfileCreationLocalSetup({
					organizationId: "org-1",
					requestId,
					storageScope: "account-1",
				})
			).toBeNull();
		}
	});

	it("finishes a remembered custom working folder on the same committed Profile", async () => {
		expect(
			rememberPendingAgentProfileCreationLocalSetup({
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
				workspacePath: "/Users/felix/Desktop/work/openmeld",
			})
		).toBe(true);

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "completed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({ failureMessage: null, pending: false });

		expect(configureWorkspaceMock).toHaveBeenCalledWith({
			agentProfileId: AGENT_PROFILE_ID,
			bindingEstablished: true,
			organizationId: "org-1",
			projectFolderPath: "/Users/felix/Desktop/work/openmeld",
			selectedHumanProfileId: "human-felix",
		});
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toBeNull();
	});

	it("carries a pre-commit custom folder intent onto the Profile committed by retry", async () => {
		expect(
			rememberPendingAgentProfileCreationLocalSetup({
				agentProfileId: null,
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
				workspacePath: "/Users/felix/Desktop/work/openmeld",
			})
		).toBe(true);

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({
					createdAgentProfileId: null,
					status: "failed",
				}),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({ failureMessage: null, pending: true });
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({
			agentProfileId: null,
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "completed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({ failureMessage: null, pending: false });
		expect(configureWorkspaceMock).toHaveBeenCalledWith({
			agentProfileId: AGENT_PROFILE_ID,
			bindingEstablished: true,
			organizationId: "org-1",
			projectFolderPath: "/Users/felix/Desktop/work/openmeld",
			selectedHumanProfileId: "human-felix",
		});
	});

	it("binds the custom folder intent as soon as retry commits the Profile", async () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: null,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "failed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({ failureMessage: null, pending: true });
		expect(configureWorkspaceMock).not.toHaveBeenCalled();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({
			agentProfileId: AGENT_PROFILE_ID,
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});

		clearPendingAgentProfileCreationLocalSetupForProfile(AGENT_PROFILE_ID);
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toBeNull();
	});

	it("requires the custom folder to be selected again when its pre-commit tab draft expires", async () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: null,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
		window.sessionStorage.clear();

		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({ agentProfileId: null, workspacePath: null });
		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "completed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({
			failureMessage:
				"Choose the custom working folder again in Agent settings on this computer.",
			pending: true,
		});
		expect(configureWorkspaceMock).not.toHaveBeenCalled();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toEqual({
			agentProfileId: AGENT_PROFILE_ID,
			workspacePath: null,
		});
	});

	it("preserves the private folder intent while Core setup remains incomplete", async () => {
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: AGENT_PROFILE_ID,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "failed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({ failureMessage: null, pending: true });

		expect(configureWorkspaceMock).not.toHaveBeenCalled();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toMatchObject({ agentProfileId: AGENT_PROFILE_ID });
	});

	it("keeps the folder intent retryable when the local write still fails", async () => {
		configureWorkspaceMock.mockRejectedValue(
			new Error("The working folder is temporarily unavailable.")
		);
		rememberPendingAgentProfileCreationLocalSetup({
			agentProfileId: AGENT_PROFILE_ID,
			organizationId: "org-1",
			requestId: "request-1",
			storageScope: "account-1",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});

		await expect(
			continuePendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				request: requestFixture({ status: "completed" }),
				selectedHumanProfileId: "human-felix",
				storageScope: "account-1",
			})
		).resolves.toEqual({
			failureMessage: "The working folder is temporarily unavailable.",
			pending: true,
		});
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "org-1",
				requestId: "request-1",
				storageScope: "account-1",
			})
		).toMatchObject({ agentProfileId: AGENT_PROFILE_ID });
	});
});

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

function requestFixture(input: {
	createdAgentProfileId?: string | null;
	status: "completed" | "failed";
}): AgentProfileCreationRequest {
	const completed = input.status === "completed";
	return {
		actorProfileId: "human-felix",
		completedAt: completed ? "2026-09-01T00:00:03.000Z" : null,
		configuration: {
			agentControllerCollaborationMode: null,
			agentControllerPermissionMode: null,
			agentControllerRef: "builtin:codex",
			authorizeForOrganization: true,
			defaultProjectId: null,
			modelId: null,
			openCodePermission: null,
			reasoningLevel: null,
			targetComputerId: "computer-1",
		},
		createdAgentProfileId:
			input.createdAgentProfileId === undefined
				? AGENT_PROFILE_ID
				: input.createdAgentProfileId,
		createdAt: "2026-09-01T00:00:00.000Z",
		decidedAt: "2026-09-01T00:00:01.000Z",
		failureMessage: completed ? null : "The Computer is offline.",
		id: "request-1",
		nativeSessionId: null,
		organizationId: "org-1",
		profileName: "Release Reviewer",
		requestedSpaceId: null,
		requesterUserId: "user-felix",
		sessionStrategy: "new",
		source: "web",
		status: input.status,
		statusReason: "profile_created",
		targetOwnerUserId: "user-felix",
		updatedAt: "2026-09-01T00:00:03.000Z",
	};
}
