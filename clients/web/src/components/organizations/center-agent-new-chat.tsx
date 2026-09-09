import {
	createCenterAgentApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	SPACE_FILE_MAX_SIZE_BYTES,
	SPACE_MESSAGE_FILE_MAX_COUNT,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { CenterAgentDirectMessageIntro } from "#/components/spaces/center-agent-direct-message-intro";
import {
	SpaceHeaderIdentityIcon,
	SpaceWindowHeader,
} from "#/components/spaces/space-header";
import type { SpaceView } from "#/components/spaces/space-view";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import {
	type ComposerDraftScope,
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
	const message = useRef<ReturnType<
		typeof createPendingCenterAgentMessage
	> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [files, setFiles] = useState<File[]>([]);
	const fileInput = useRef<HTMLInputElement>(null);
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
			if (!text && files.length === 0) {
				return;
			}
			if (!sidebar.preferences || sidebar.disabled) {
				throw new Error("Chat settings are still loading. Try again.");
			}
			const intent = readOrCreateChatIntent(sessionStorage, intentKey, text);
			message.current = {
				...intent.message,
				...(files.length ? { files } : {}),
			};
			const api = createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: organization.id,
				})
			);
			const session = await api.createSession({
				creationId: intent.creationId,
			});
			const chats = sidebar.preferences.chats ?? EMPTY_CHAT_PREFERENCES;
			await sidebar.saveAsync({
				...sidebar.preferences,
				chats: {
					...chats,
					titles: {
						...chats.titles,
						[session.spaceId]: (
							titleDraft.content.text ||
							text ||
							files[0]?.name ||
							"New chat"
						).slice(0, 160),
					},
					groups: chats.groups.map((item) =>
						item.id === group && !item.spaceIds.includes(session.spaceId)
							? { ...item, spaceIds: [...item.spaceIds, session.spaceId] }
							: item
					),
				},
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
				message.current
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
				removeComposerDraft(draftScope);
				removeComposerDraft({ ...draftScope, sessionId: "new-chat-title" });
			}
			sessionStorage.removeItem(intentKey);
		},
		onError: (cause) => setError(toStructuredApiClientFailure(cause).message),
	});
	return (
		<div className="flex min-h-0 w-full flex-1 flex-col">
			{error && (
				<p className="px-5 py-2 text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
			<CenterAgentOptimisticConversation
				composerAccessory={
					<div className="flex flex-wrap items-center gap-1">
						<input
							aria-label="Choose files to send"
							className="hidden"
							multiple
							onChange={(event) => {
								const selected = Array.from(event.target.files ?? []);
								if (
									files.length + selected.length >
										SPACE_MESSAGE_FILE_MAX_COUNT ||
									selected.some((file) => file.size > SPACE_FILE_MAX_SIZE_BYTES)
								) {
									setError(
										`Choose up to ${SPACE_MESSAGE_FILE_MAX_COUNT} files, each 10 MiB or smaller.`
									);
								} else {
									setFiles((current) => [...current, ...selected]);
									setError(null);
								}
								event.target.value = "";
							}}
							ref={fileInput}
							type="file"
						/>
						<Button
							aria-label="Add files"
							disabled={send.isPending}
							onClick={() => fileInput.current?.click()}
							size="icon-sm"
							variant="ghost"
						>
							<PlusIcon />
						</Button>
						{files.map((file, index) => (
							<Button
								aria-label={`Remove ${file.name}`}
								disabled={send.isPending}
								key={`${file.name}:${file.lastModified}:${index}`}
								onClick={() =>
									setFiles((current) =>
										current.filter((_, position) => position !== index)
									)
								}
								size="sm"
								variant="ghost"
							>
								<span className="max-w-36 truncate">{file.name}</span>
								<XIcon className="size-3" />
							</Button>
						))}
					</div>
				}
				composerText={draft.content.text}
				empty
				emptyContent={
					view === "messages" ? (
						<CenterAgentDirectMessageIntro
							disabled={send.isPending}
							isPersonalContext={organization.isPersonal === true}
							onSelectStarterAction={(prompt) => send.mutateAsync(prompt)}
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
				hasAttachments={files.length > 0}
				header={
					<SpaceWindowHeader
						actions={
							<CenterAgentHeaderMenu organizationSlug={organization.slug} />
						}
						leadingControl={<SpaceHeaderIdentityIcon isDirectMessage />}
						navigation={
							<CenterAgentHeaderTabs
								activeSectionId="chat"
								activeSpaceView={view}
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
						message.current = null;
						draft.setContent((current) => ({ ...current, text }));
					}
				}}
				onSend={() => {
					if (!send.isPending && (draft.content.text.trim() || files.length)) {
						setError(null);
						send.mutate();
					}
				}}
				pendingMessage={send.isPending ? message.current : null}
			/>
		</div>
	);
}
