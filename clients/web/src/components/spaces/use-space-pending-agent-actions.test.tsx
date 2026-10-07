import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	AuthProfileView,
	GetAgentProfilePrimaryBindingResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { useSpacePendingAgentActions } from "./use-space-pending-agent-actions";

const updatePermissionModeMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("#/components/agents/agent-profile-edit-actions", () => ({
	updateAgentProfileControllerPermissionMode: updatePermissionModeMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

describe("useSpacePendingAgentActions", () => {
	beforeEach(() => {
		updatePermissionModeMock.mockReset();
		toastErrorMock.mockReset();
		toastSuccessMock.mockReset();
	});

	it("reports that the future mode was saved without claiming the running Wake changed", async () => {
		const onSaved = vi.fn().mockResolvedValue(undefined);
		updatePermissionModeMock.mockResolvedValue({
			agentProfileId: AGENT_PROFILE_ID,
			authoritySource: "binding_truth",
			bindingId: "binding-1",
			bindingState: "enabled_primary",
			dispatchEligibility: {
				reasonCodes: [],
				routable: true,
				status: "routable",
			},
			grantsClaimSuccess: false,
			agentControllerPermissionMode: "claude-code:auto",
			reasonCodes: [],
			resolutionSource: "binding_truth",
			routable: true,
			executionTarget: {
				agentControllerRef: "builtin:claude-code",
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority",
					value: "runtime-1",
				},
			},
		} satisfies GetAgentProfilePrimaryBindingResponse["binding"]);
		const { result } = renderPendingAgentActionsHook({ onSaved });

		const callbackResult = result.current.surfaceProps.onPermissionModeUpdate?.(
			{
				permissionMode: "claude-code:auto",
				profileId: AGENT_PROFILE_ID,
			}
		);

		await expect(callbackResult).resolves.toEqual({
			bindingId: "binding-1",
			mode: "claude-code:auto",
		});
		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalledWith(
				"Auto mode saved for Piper.",
				{
					description:
						"It applies after OpenMeld Service syncs. This Wake changes only if the local agent accepts the update live.",
				}
			);
		});
		expect(onSaved).toHaveBeenCalledWith(AGENT_PROFILE_ID);
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("keeps approval pending and offers direct profile editing when saving fails", async () => {
		const error = new Error("Permission mode write failed");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		updatePermissionModeMock.mockRejectedValue(error);
		const { result } = renderPendingAgentActionsHook();

		const callbackResult = result.current.surfaceProps.onPermissionModeUpdate?.(
			{
				permissionMode: "claude-code:auto",
				profileId: AGENT_PROFILE_ID,
			}
		);

		await expect(callbackResult).rejects.toBe(error);
		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce());
		const [message, options] = toastErrorMock.mock.calls[0] ?? [];
		expect(message).toBe(
			"Couldn't confirm Auto mode for Piper. The request is still waiting for approval."
		);
		expect(options?.action?.label).toBe("Edit Agent Profile");

		act(() => options?.action?.onClick());
		expect(result.current.profileEditDialog).not.toBeNull();
		expect(toastSuccessMock).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

const AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

function renderPendingAgentActionsHook(
	input: { onSaved?: AgentProfileEditDialogContext["onSaved"] } = {}
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
	const agentProfileEditContext: AgentProfileEditDialogContext = {
		actorProfileId: "human-profile-1",
		deviceId: "device-1",
		executionTarget: null,
		onSaved: input.onSaved ?? vi.fn().mockResolvedValue(undefined),
		organizationId: "org-acme",
		runtimeLane: "prod",
		storageScope: "account:user-felix",
	};

	return renderHook(
		() =>
			useSpacePendingAgentActions({
				accountProfiles: [createAgentProfile()],
				agentProfileEditContext,
				currentOwnerUserId: "user-felix",
				membersSnapshot: createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentControllerPermissionMode: "claude-code:default",
							agentControllerRef: "builtin:claude-code",
							ownerUserId: "user-felix",
							profileId: AGENT_PROFILE_ID,
							profileName: "Piper",
						}),
					],
				}),
				modelCatalog: null,
				onRespond: vi.fn().mockResolvedValue(undefined),
				presentedItems: [],
				threadItems: [],
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		}
	);
}

function createAgentProfile(): AuthProfileView {
	return {
		createdAt: "2026-08-29T00:00:00.000Z",
		createdByUserId: "user-felix",
		creatorProfileId: "human-profile-1",
		isDefault: false,
		lastUsedAt: "2026-08-29T00:00:00.000Z",
		managedRole: null,
		openMeldProfileId: AGENT_PROFILE_ID,
		ownerName: "Felix",
		ownerUserId: "user-felix",
		profileHandle: "piper",
		profileKind: "agent",
		profileName: "Piper",
		source: "manual",
		status: "active",
		updatedAt: "2026-08-29T00:00:00.000Z",
	};
}
