import type {
	AuthProfileView,
	GetSpaceMessageDetailsResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { spaceMessageDetailsQueryOptions } from "#/query/spaces/message-details";
import { SpaceAgentProfileEditProvider } from "./space-agent-profile-edit-context";
import type { SpaceExecutionRecoveryHandler } from "./space-execution-recovery-actions";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";

// Smoke R5-01 / R6-01: the owner's Direct Message drawer, mounted as
// SpaceLanding mounts it, offers "Continue in <default folder>" for a
// published execution_context.workspace_changed failure.

const postNormalMessage = vi.hoisted(() => vi.fn());
const readFolders = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		postNormalMessage,
		postThreadSignal: vi.fn(),
	}),
}));
vi.mock("#/lib/profiles/agent-profile-folders", () => ({
	readAgentProfileFolders: readFolders,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
	useNavigate: () => vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CONTINUE_IN = /^Continue in/u;
const AGENT = "agt_11111111-1111-4111-8111-111111111111";
const OWNER_HUMAN = "human-owner";
const FOLDER_ONE = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const SPACE = "space-dm";

function agentProfile(ownerUserId: string): AuthProfileView {
	return {
		defaultProjectId: null,
		managedRole: null,
		openMeldProfileId: AGENT,
		ownerUserId,
		profileKind: "agent",
		profileName: "Claude Code",
		status: "active",
	} as unknown as AuthProfileView;
}

function timelineItem(
	input: { id: string } & Partial<SpaceTimelineItem>
): SpaceTimelineItem {
	return {
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Felix",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: OWNER_HUMAN,
		actorProfileKind: "human",
		actorProfileName: "Felix",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: Date.UTC(2026, 9, 19, 10, 23),
		deliveryState: "sent",
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: SPACE,
		systemNoticeType: null,
		text: "Reply RECOVERED only.",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...input,
	} as SpaceTimelineItem;
}

function messageDetails(input: {
	selectNotice: boolean;
}): GetSpaceMessageDetailsResponse {
	const notApplicable = {
		source: "none",
		state: "not_applicable",
		value: null,
	} as never;
	const recorded = (value: string) =>
		({ source: "signal", state: "recorded", value }) as never;
	// Every agent fact is not applicable to a human's message.
	const agentContext = new Proxy(
		{ state: "not_applicable" },
		{
			get: (target, key) =>
				key in target ? target[key as "state"] : notApplicable,
		}
	);
	return {
		agentContext,
		diagnostics: { signalId: "sig-request", traceSelectors: [] },
		message: {
			actor: {
				displayName: "Felix",
				profileHandle: null,
				profileId: OWNER_HUMAN,
				profileKind: "human",
				profileName: "Felix",
			},
			sentAtMs: Date.UTC(2026, 9, 19, 10, 23),
			signalId: "sig-request",
			signalType: "signal.text",
		},
		query: { signalId: "sig-request", spaceId: SPACE },
		replyContext: input.selectNotice
			? {
					previewText: recorded("Reply RECOVERED only."),
					replyingToAuthor: recorded("Felix"),
					replyingToSignalId: recorded("sig-request"),
					resolved: true,
					state: "recorded",
				}
			: {
					previewText: notApplicable,
					replyingToAuthor: notApplicable,
					replyingToSignalId: notApplicable,
					resolved: false,
					state: "not_applicable",
				},
		wakeContext: {
			clientMessageId: notApplicable,
			sourceSignalId: notApplicable,
			state: "not_applicable",
			targets: [],
		},
	} as unknown as GetSpaceMessageDetailsResponse;
}

// The Space page always inspects exact recovery first; a changed folder has
// none, so the folder continuation is the action.
const unavailableExecutionRecovery: SpaceExecutionRecoveryHandler =
	async () => ({
		action: null,
		label: null,
		status: "unavailable",
		warning: null,
	});

function failureNotice(): SpaceTimelineItem {
	return timelineItem({
		actorProfileId: AGENT,
		actorProfileKind: "agent",
		id: "sig-failure",
		replyToSignalId: "sig-request",
		signalType: "signal.system_notice",
		systemNoticeDispatchId: "dispatch-after-repair",
		systemNoticeFailureStage: "execution",
		systemNoticeReasonCode: "execution_context.workspace_changed",
		systemNoticeTargetProfileId: AGENT,
		systemNoticeType: "terminal_failure",
		text: "Claude Code couldn't reply: This chat’s session works in a folder that is no longer the Agent’s working folder.",
	});
}

function renderDirectMessageDrawer(input: {
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	ownerUserId: string;
	/** Open the failure notice itself instead of the request. */
	selectNotice?: boolean;
}) {
	const selected = input.selectNotice
		? failureNotice()
		: timelineItem({ id: "sig-request", wakeTargetProfileIds: [AGENT] });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	queryClient.setQueryData(
		spaceMessageDetailsQueryOptions({
			enabled: true,
			openMeldProfileId: OWNER_HUMAN,
			signalId: selected.id,
			spaceId: SPACE,
		}).queryKey,
		messageDetails({ selectNotice: input.selectNotice === true })
	);
	const editContext = {
		actorProfileId: OWNER_HUMAN,
		onSaved: vi.fn(async () => undefined),
		organizationId: "org-1",
		storageScope: "account-1",
	} as unknown as AgentProfileEditDialogContext;
	render(
		<QueryClientProvider client={queryClient}>
			<SpaceAgentProfileEditProvider
				accountProfiles={[agentProfile(input.ownerUserId)]}
				context={editContext}
				currentOwnerUserId="user-owner"
				modelCatalog={null}
				organizationId="org-1"
				orgSlug="acme"
			>
				<SpaceMessageDetailsDrawer
					canJumpToMessage={() => false}
					canStartNewTask={true}
					diagnosticReportStatus="idle"
					errorLogMessage="Failed to report a space message."
					item={selected}
					onJumpToMessage={vi.fn()}
					onOpenChange={vi.fn()}
					onRecoverExecution={
						input.onRecoverExecution ?? unavailableExecutionRecovery
					}
					onReportMessage={vi.fn(async () => undefined)}
					open={true}
					openMeldProfileId={OWNER_HUMAN}
					orgSlug="acme"
					replyItems={input.selectNotice ? [] : [failureNotice()]}
					spaceId={SPACE}
					targetProfileDisplayNamesByProfileId={
						new Map([[AGENT, "Claude Code"]])
					}
				/>
			</SpaceAgentProfileEditProvider>
		</QueryClientProvider>
	);
}

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	postNormalMessage.mockResolvedValue({ ok: true });
	readFolders.mockResolvedValue({
		agentProfileId: AGENT,
		observedAtMs: 1,
		projection: {
			defaultFolderId: FOLDER_ONE,
			folders: [
				{
					displayName: "folder-one",
					folderId: FOLDER_ONE,
					isDefault: true,
					kind: "custom",
				},
			],
			revision: 4,
		},
		status: "current",
		target: { deviceId: "device-1", runtimeLane: "prod" },
	});
});

describe("Direct Message drawer after a working-folder repair", () => {
	it("offers the owner Continue in the repaired folder and posts a new Session", async () => {
		renderDirectMessageDrawer({ ownerUserId: "user-owner" });
		const activity = await screen.findByRole("region", {
			name: "Claude Code activity",
		});
		fireEvent.click(
			await within(activity).findByRole("button", {
				name: "Continue in folder-one",
			})
		);
		await waitFor(() => expect(postNormalMessage).toHaveBeenCalledTimes(1));
		expect(postNormalMessage.mock.calls[0]?.[0]).toMatchObject({
			contextSelection: { mode: "new" },
			messageEnvelope: {
				activationTargets: [AGENT],
				replyToSignalId: "sig-request",
			},
			spaceId: SPACE,
		});
	});

	it("offers it once exact execution recovery is unavailable", async () => {
		const onRecoverExecution = vi.fn<SpaceExecutionRecoveryHandler>(
			async () => ({
				action: null,
				label: null,
				status: "unavailable",
				warning: null,
			})
		);
		renderDirectMessageDrawer({
			onRecoverExecution,
			ownerUserId: "user-owner",
		});
		const activity = await screen.findByRole("region", {
			name: "Claude Code activity",
		});
		expect(
			await within(activity).findByRole("button", {
				name: "Continue in folder-one",
			})
		).toBeTruthy();
		expect(onRecoverExecution).toHaveBeenCalled();
	});

	it("continues the answered request when the failure notice itself is open", async () => {
		renderDirectMessageDrawer({
			ownerUserId: "user-owner",
			selectNotice: true,
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Continue in folder-one" })
		);
		await waitFor(() => expect(postNormalMessage).toHaveBeenCalledTimes(1));
		const sent = postNormalMessage.mock.calls[0]?.[0];
		expect(sent.messageEnvelope.replyToSignalId).toBe("sig-request");
		expect(sent.text).toContain("Reply RECOVERED only.");
	});

	it("offers nothing to a viewer who does not own the Agent", async () => {
		renderDirectMessageDrawer({ ownerUserId: "user-colleague" });
		await screen.findByRole("region", { name: "Claude Code activity" });
		expect(screen.queryByRole("button", { name: CONTINUE_IN })).toBeNull();
		expect(readFolders).not.toHaveBeenCalled();
	});
});
