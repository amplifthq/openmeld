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
import {
	SpaceHeaderIdentityIcon,
	SpaceWindowHeader,
} from "#/components/spaces/space-header";
import type { SpaceView } from "#/components/spaces/space-view";
import { useSpaceComposerFiles } from "#/components/spaces/use-space-composer-attachments";
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
	type createPendingCenterAgentMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { centerAgentDirectMessageSpaceProjectionQueryOptions } from "#/query/organizations/center-agent";
import {
	CenterAgentHeaderMenu,
	CenterAgentHeaderTabs,
} from "./center-agent-header-navigation";
import { CenterAgentOptimisticConversation } from "./center-agent-optimistic-conversation";
import { ChatTitleEditor } from "./chat-title-editor";

function clearSentDraft(scope: ComposerDraftScope, updatedAtMs: number) {
	if (readComposerDraft(scope)?.updatedAtMs === updatedAtMs) {
		removeComposerDraft(scope);
	}
}

/** Opening this composer is local; only an intentional first send creates a chat. */
export function CenterAgentNewChat({
	group,
	view = "messages",
}: {
	group?: string;
	view?: SpaceView;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { storageScope } = useStartFlowState();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const sidebar = useSidebarPreferences(
		defaultHumanProfile?.openMeldProfileId ?? "",
		organization.id
	);
	const [message, setMessage] = useState<ReturnType<
		typeof createPendingCenterAgentMessage
	> | null>(null);
	const sending = useRef(false);
	const [error, setError] = useState<string | null>(null);
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
	const send = useMutation({
		mutationFn: async (starterPrompt?: string) => {
			const text = (starterPrompt ?? draft.content.text).trim();
			if (!text && attachments.files.length === 0) {
				return;
			}
			const intent = readOrCreateChatIntent(sessionStorage, intentKey, text);
			const intentValue = sessionStorage.getItem(intentKey);
			setMessage({ ...intent.message, files: attachments.getSourceFiles() });
			const fileDrafts = await attachments.readFileDrafts();
			const pendingMessage = {
				...intent.message,
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
			if (!mounted.current) {
				return;
			}
			sidebar
				.updateAsync((preferences) => {
					const chats = preferences.chats ?? EMPTY_CHAT_PREFERENCES;
					return {
						...preferences,
						chats: {
							...chats,
							titles: {
								...chats.titles,
								[session.spaceId]: (
									titleDraft.content.text ||
									text ||
									attachments.files[0]?.fileName ||
									"New chat"
								).slice(0, 160),
							},
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
		onError: (cause) => setError(toStructuredApiClientFailure(cause).message),
	});
	const startSend = async (prompt?: string) => {
		if (sending.current) {
			return;
		}
		sending.current = true;
		setError(null);
		try {
			await send.mutateAsync(prompt);
		} catch {
			/* The mutation reports the failure inline and retains the draft. */
		} finally {
			sending.current = false;
		}
	};
	useLayoutEffect(
		() =>
			registerClientVersionRecoveryBlocker(
				() => attachments.files.length > 0 || send.isPending
			),
		[attachments.files.length, send.isPending]
	);
	return (
		<div className="flex min-h-0 w-full flex-1 flex-col">
			{error && (
				<p className="px-5 py-2 text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
			<CenterAgentOptimisticConversation
				attachments={attachments}
				composerText={send.isPending ? "" : draft.content.text}
				empty
				emptyContent={
					view === "messages" ? (
						<CenterAgentDirectMessageIntro
							disabled={send.isPending}
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
					) : (
						<div className="py-12 text-center text-muted-foreground text-sm">
							{view === "files"
								? "Files shared in this chat will appear here."
								: "Connections from this chat will appear here."}
						</div>
					)
				}
				header={
					<SpaceWindowHeader
						actions={
							<CenterAgentHeaderMenu organizationSlug={organization.slug} />
						}
						leadingControl={<SpaceHeaderIdentityIcon isDirectMessage />}
						navigation={
							<CenterAgentHeaderTabs
								activeSectionId="chat"
								activeSpaceView={view === "tasks" ? "messages" : view}
								idPrefix="new-chat-view"
								onSpaceViewChange={(nextView) => {
									navigate({
										to: buildOrganizationCenterAgentChatPath(
											organization.slug,
											{ draft: "new", group, view: nextView }
										),
									});
								}}
								organizationSlug={organization.slug}
							/>
						}
						secondaryContentClassName="overflow-x-auto"
						title={titleDraft.content.text || "New chat"}
						titleAdornment={
							<ChatTitleEditor
								disabled={send.isPending}
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
				onComposerChange={(text) => {
					if (!send.isPending) {
						setMessage(null);
						draft.setContent((current) => ({ ...current, text }));
					}
				}}
				onSend={() => {
					if (
						!send.isPending &&
						(draft.content.text.trim() || attachments.files.length)
					) {
						setError(null);
						startSend();
					}
				}}
				pendingMessage={send.isPending ? message : null}
				selfProfile={defaultHumanProfile}
			/>
		</div>
	);
}
