import {
	createCenterAgentApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { CenterAgentDirectMessageIntro } from "#/components/spaces/center-agent-direct-message-intro";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import type { SpaceTaskDraft } from "#/components/spaces/space-task-draft-fields";
import type { CenterAgentSpaceView } from "#/components/spaces/space-view";
import {
	ComposerFileDiscoveryError,
	useSpaceComposerFiles,
} from "#/components/spaces/use-space-composer-attachments";
import { useAccountAvatar } from "#/hooks/account.hooks";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import {
	type ComposerDraftScope,
	readComposerDraft,
	removeComposerDraft,
} from "#/lib/composer-draft-storage";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { readOrCreateChatIntent } from "#/lib/organizations/center-agent-chat-intent";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import {
	clearCenterAgentPendingMessage,
	type createPendingCenterAgentMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { resolveRequestedStopUiStatus } from "#/lib/spaces/wake-stop-target";
import { centerAgentDirectMessageSpaceProjectionQueryOptions } from "#/query/organizations/center-agent";
import { useCenterAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";
import { postWebSpaceWakeStop } from "#/query/spaces/wake-stop";
import { CenterAgentChatHistory } from "./center-agent-chat-history";
import { CenterAgentHeaderTabs } from "./center-agent-header-navigation";
import { CenterAgentNewChatTasks } from "./center-agent-new-chat-tasks";
import { CenterAgentOptimisticConversation } from "./center-agent-optimistic-conversation";
import { ChatTitleEditor } from "./chat-title-editor";

function clearSentDraft(scope: ComposerDraftScope, updatedAtMs: number) {
	if (readComposerDraft(scope)?.updatedAtMs === updatedAtMs) {
		removeComposerDraft(scope);
	}
}

type NewChatSendAttempt = {
	cancelled: boolean;
	clientMessageId?: string;
	session?: { spaceId: string; centerAgentProfileId: string };
};

/** Opening this composer is local; only an intentional first send creates a chat. */
export function CenterAgentNewChat({
	group,
	view = "messages",
}: {
	group?: string;
	view?: CenterAgentSpaceView;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { storageScope } = useStartFlowState();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const centerAgentProfile = useCenterAgentAvatarProfile();
	const { data: accountAvatar } = useAccountAvatar();
	const sidebar = useSidebarPreferences(organization.id);
	const [message, setMessage] = useState<ReturnType<
		typeof createPendingCenterAgentMessage
	> | null>(null);
	const sending = useRef(false);
	const activeAttempt = useRef<NewChatSendAttempt | null>(null);
	const [stopStatus, setStopStatus] = useState<
		"stopping" | "stopped" | "unconfirmed"
	>();
	const [error, setError] = useState<string | null>(null);
	const [taskDraft, setTaskDraft] = useState<SpaceTaskDraft | null>(null);
	const attachments = useSpaceComposerFiles({
		organizationSlug: organization.slug,
		profileId: defaultHumanProfile?.openMeldProfileId ?? storageScope ?? "",
		spaceId: "new-chat-draft",
		draftScope: storageScope,
		deferUpload: true,
	});
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const intentKey = `openmeld.chat-intent:${storageScope}:${organization.id}`;
	const draftScope: ComposerDraftScope | null = storageScope
		? {
				kind: "center_agent_pending",
				organizationId: organization.id,
				ownerAccountId: storageScope,
				sessionId: "new-chat-draft",
			}
		: null;
	const draft = useComposerDraft({ scope: draftScope });
	const titleDraft = useComposerDraft({
		scope: draftScope ? { ...draftScope, sessionId: "new-chat-title" } : null,
	});
	const messageText = draft.content.text.trim() || taskDraft?.title || "";
	const pendingTaskDraft = taskDraft ?? undefined;
	const send = useMutation({
		mutationFn: async ({
			starterPrompt,
			attempt,
		}: {
			starterPrompt?: string;
			attempt: NewChatSendAttempt;
		}) => {
			const text = (starterPrompt ?? messageText).trim();
			if (!text && attachments.files.length === 0) {
				return;
			}
			const intent = readOrCreateChatIntent(sessionStorage, intentKey, text);
			const intentValue = sessionStorage.getItem(intentKey);
			attempt.clientMessageId = intent.message.clientMessageId;
			setMessage(intent.message);
			const fileDrafts = await attachments.readFileDrafts();
			if (attempt.cancelled || !mounted.current) {
				return;
			}
			const pendingMessage = {
				...intent.message,
				taskDraft: pendingTaskDraft,
				files: fileDrafts.map((draft) => draft.file),
				fileDrafts,
			};
			setMessage(pendingMessage);
			const api = createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: organization.id,
				})
			);
			const session = await api.createSession({
				creationId: intent.creationId,
			});
			if (attempt.cancelled || !mounted.current) {
				return;
			}
			if (titleDraft.content.text || group) {
				sidebar
					.updateAsync((preferences) => {
						const chats = preferences.chats ?? EMPTY_CHAT_PREFERENCES;
						return {
							...preferences,
							chats: {
								...chats,
								titles: titleDraft.content.text
									? {
											...chats.titles,
											[session.spaceId]: titleDraft.content.text.slice(0, 160),
										}
									: chats.titles,
								groups: chats.groups.map((item) =>
									item.id === group && !item.spaceIds.includes(session.spaceId)
										? { ...item, spaceIds: [...item.spaceIds, session.spaceId] }
										: item
								),
							},
						};
					})
					.catch((cause: unknown) => {
						console.error("Could not name or group the new chat", cause);
						toast.error(
							"Your chat is open, but its name and group couldn't be saved. You can update them in the sidebar."
						);
					});
			}
			queryClient.setQueryData(
				centerAgentDirectMessageSpaceProjectionQueryOptions({
					enabled: true,
					organizationId: organization.id,
					spaceId: session.spaceId,
				}).queryKey,
				{
					generatedAt: new Date().toISOString(),
					organizationId: organization.id,
					projection: {
						organizationId: session.organizationId,
						spaceId: session.spaceId,
						centerAgentProfileId: session.centerAgentProfileId,
						memberProfileId: session.memberProfileId,
						kind: "center_agent_direct_message_space",
						isCenterAgentDirectMessageSpace: true,
					},
				}
			);
			writeCenterAgentPendingMessage(
				queryClient,
				{
					organizationId: organization.id,
					organizationSlug: organization.slug,
					sessionId: session.spaceId,
				},
				pendingMessage
			);
			attempt.session = session;
			queryClient.invalidateQueries({
				queryKey: [
					"center-agent",
					organization.id,
					defaultHumanProfile?.openMeldProfileId ?? "",
					"sessions",
				],
			});
			await navigate({
				to: buildOrganizationCenterAgentChatPath(organization.slug, {
					session: session.spaceId,
				}),
				replace: true,
			});
			if (attempt.cancelled) {
				return;
			}
			// Navigation unmounts this composer; clearing React state would not persist.
			if (draftScope) {
				clearSentDraft(draftScope, draft.record.updatedAtMs);
				clearSentDraft(
					{ ...draftScope, sessionId: "new-chat-title" },
					titleDraft.record.updatedAtMs
				);
			}
			if (sessionStorage.getItem(intentKey) === intentValue) {
				sessionStorage.removeItem(intentKey);
			}
		},
		onError: (cause, { attempt }) => {
			if (attempt.cancelled || activeAttempt.current !== attempt) {
				return;
			}
			setMessage(null);
			setError(
				cause instanceof ComposerFileDiscoveryError
					? cause.message
					: toStructuredApiClientFailure(cause).message
			);
		},
	});
	const startSend = async (prompt?: string) => {
		if (sending.current) {
			return;
		}
		sending.current = true;
		const attempt: NewChatSendAttempt = { cancelled: false };
		activeAttempt.current = attempt;
		setStopStatus(undefined);
		setError(null);
		try {
			await send.mutateAsync({ starterPrompt: prompt, attempt });
		} catch {
			/* The mutation reports the failure inline and retains the draft. */
		} finally {
			if (activeAttempt.current === attempt) {
				sending.current = false;
			}
		}
	};
	const stopSend = async () => {
		const attempt = activeAttempt.current;
		if (!attempt || stopStatus === "stopping") {
			return;
		}
		attempt.cancelled = true;
		sending.current = false;
		sessionStorage.removeItem(intentKey);
		if (!(attempt.session && attempt.clientMessageId)) {
			setStopStatus("stopped");
			return;
		}
		setStopStatus("stopping");
		const session = attempt.session;
		clearCenterAgentPendingMessage(queryClient, {
			organizationId: organization.id,
			organizationSlug: organization.slug,
			sessionId: session.spaceId,
		});
		try {
			const response = await postWebSpaceWakeStop({
				openMeldProfileId: defaultHumanProfile?.openMeldProfileId ?? "",
				spaceId: session.spaceId,
				body: {
					target: {
						by: "client_message",
						clientMessageId: attempt.clientMessageId,
						targetProfileId: session.centerAgentProfileId,
					},
				},
			});
			if (activeAttempt.current === attempt) {
				const status = resolveRequestedStopUiStatus(response.status);
				setStopStatus(
					status === "stopping" || status === "stopped" ? status : "unconfirmed"
				);
			}
		} catch {
			if (activeAttempt.current === attempt) {
				setStopStatus("unconfirmed");
			}
		}
	};
	const isSending = send.isPending && stopStatus !== "stopped";
	useLayoutEffect(
		() =>
			registerClientVersionRecoveryBlocker(
				() => attachments.files.length > 0 || isSending
			),
		[attachments.files.length, isSending]
	);
	const header = (
		<SpaceWindowHeader
			navigation={
				<CenterAgentHeaderTabs
					activeSectionId="chat"
					activeSpaceView={view}
					idPrefix="new-chat-view"
					onSpaceViewChange={(nextView) => {
						navigate({
							to: buildOrganizationCenterAgentChatPath(organization.slug, {
								draft: "new",
								group,
								view: nextView,
							}),
						});
					}}
					organizationSlug={organization.slug}
				/>
			}
			secondaryContentClassName="overflow-x-auto"
			title={titleDraft.content.text || "New chat"}
			titleControl={
				<CenterAgentChatHistory
					disabled={isSending}
					title={titleDraft.content.text || "New chat"}
					titleAction={
						<ChatTitleEditor
							disabled={isSending}
							onSave={(title) => {
								titleDraft.setContent((current) => ({
									...current,
									text: title,
								}));
							}}
							title={titleDraft.content.text || "New chat"}
						/>
					}
				/>
			}
		/>
	);
	const taskMembers = [
		...(defaultHumanProfile
			? [
					{
						profileId: defaultHumanProfile.openMeldProfileId,
						profileName: defaultHumanProfile.profileName,
					},
				]
			: []),
		...(centerAgentProfile ? [centerAgentProfile] : []),
	];
	if (view === "tasks") {
		return (
			<div className="flex min-h-0 w-full flex-1 flex-col">
				{header}
				<CenterAgentNewChatTasks
					members={taskMembers}
					profileId={defaultHumanProfile?.openMeldProfileId}
				/>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 w-full flex-1 flex-col">
			{error && (
				<p className="px-5 py-2 text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
			<CenterAgentOptimisticConversation
				attachments={attachments}
				composerText={isSending ? "" : draft.content.text}
				empty
				emptyContent={
					<>
						{view === "messages" && (
							<CenterAgentDirectMessageIntro
								disabled={isSending}
								isPersonalContext={organization.isPersonal === true}
								onSelectStarterAction={startSend}
								onStartComputerSetup={() => {
									navigate({
										to: buildConnectComputerPath({
											orgSlug: organization.slug,
											profileId: defaultHumanProfile?.openMeldProfileId,
										}),
									});
								}}
								showStarterActions
								showStarterComputerSetup={false}
							/>
						)}
						{(view === "files" || view === "graph") && (
							<div className="py-12 text-center text-muted-foreground text-sm">
								{view === "files"
									? "Files shared in this chat will appear here."
									: "Connections from this chat will appear here."}
							</div>
						)}
					</>
				}
				header={header}
				onComposerChange={(text) => {
					if (!isSending) {
						setMessage(null);
						draft.setContent((current) => ({ ...current, text }));
					}
				}}
				onSend={() => {
					if (
						!isSending &&
						(!taskDraft || taskDraft.title.trim()) &&
						(taskDraft?.title.trim() ||
							draft.content.text.trim() ||
							attachments.files.length)
					) {
						setError(null);
						startSend();
					}
				}}
				onStop={stopSend}
				onTaskDraftChange={setTaskDraft}
				pendingMessage={message}
				selfAvatarImageUrl={accountAvatar?.avatar}
				selfProfile={defaultHumanProfile}
				stopStatus={stopStatus}
				taskDraft={taskDraft}
				taskMembers={taskMembers}
			/>
		</div>
	);
}
