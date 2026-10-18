import { Button } from "@openmeld/ui/components/button";
import { TextShimmer } from "@openmeld/ui/components/text-shimmer";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import type { ComposerDraftScope } from "#/lib/composer-draft-storage";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import type { PendingSpaceMessage } from "#/lib/spaces/pending-message";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import {
	addSpaceDirectoryMembers,
	useSpaceMemberAddition,
	useSpaceMemberAdditions,
} from "#/query/spaces/member-additions";
import {
	type SpaceCreationRequest,
	spaceCreationReceiptKey,
	useSpaceCreations,
} from "#/query/spaces/space-creation";
import { AppSpaceShell } from "./app-space-shell";
import { SpaceComposer } from "./space-composer";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";
import { SpaceWindowHeader } from "./space-header";
import { SpaceLanding } from "./space-landing";
import type { SpaceView } from "./space-view";
import { SpaceViewTabs } from "./space-view-tabs";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";

type Creation = ReturnType<typeof useSpaceCreations>[number];

function creationError(
	failed: boolean,
	openFailed: boolean,
	queueError: string | null
) {
	if (failed) {
		return "Couldn't confirm that the Space was created. Your draft is still here. Check Spaces before trying again.";
	}
	if (openFailed) {
		return "Your Space was created, but couldn't be opened. Your draft is still here.";
	}
	return queueError;
}

/** A local creation receipt can present a conversation, never grant Space access. */
export function SpaceCreationRoute(input: {
	children: ReactNode;
	spaceId: string;
	profileId?: string;
}) {
	const { currentOrganization } = useAppOrganization();
	const creations = useSpaceCreations(
		currentOrganization.id,
		input.profileId ?? ""
	);
	const receipt = useQuery<Creation | null>({
		queryKey: spaceCreationReceiptKey(
			currentOrganization.id,
			input.profileId ?? "",
			input.spaceId
		),
		queryFn: () => null,
		enabled: false,
	});
	const matches = (creation: Creation) =>
		creation.organizationId === currentOrganization.id &&
		creation.profileId === input.profileId &&
		(creation.input?.creationId === input.spaceId ||
			creation.response?.spaceId === input.spaceId);
	// Keep the confirmed handoff mounted after the sidebar retires its receipt.
	const retained = useRef<Creation | null>(null);
	const current = creations.find(matches) ?? receipt.data;
	if (current) {
		retained.current = current;
	} else if (retained.current && !matches(retained.current)) {
		retained.current = null;
	}
	const creation = current ?? retained.current;
	if (creation?.input && input.profileId) {
		return (
			<SpaceCreationConversation
				creation={creation}
				key={creation.input.creationId}
				profileId={input.profileId}
				request={creation.input}
			/>
		);
	}
	if (input.spaceId.startsWith("creating-")) {
		return (
			<div className="p-6 text-sm">
				<p>
					This creation request is no longer available. Check Spaces before
					creating another one.
				</p>
				<Link
					className="underline"
					to={buildOrganizationSpacesPath(currentOrganization.slug)}
				>
					Check Spaces
				</Link>
			</div>
		);
	}
	return input.children;
}

function useCreationMembers(input: {
	organizationId: string;
	profileId: string;
	spaceId: string | undefined;
	members: SpaceCreationRequest["members"];
}) {
	const client = useQueryClient();
	const additions = useSpaceMemberAdditions({
		organizationId: input.organizationId,
		profileId: input.profileId,
		spaceId: input.spaceId ?? "",
	});
	const requestedIds = new Set(
		input.members?.map((member) => member.profileId)
	);
	const addition = additions
		.filter((item) => {
			const ids = item.input?.directoryProfileIds;
			return (
				ids?.length === requestedIds.size &&
				ids.every((id) => requestedIds.has(id))
			);
		})
		.at(-1);
	const retryAddition = useSpaceMemberAddition({
		organizationId: input.organizationId,
		profileId: input.profileId,
		add: (next) =>
			addSpaceDirectoryMembers({
				organizationId: input.organizationId,
				profileId: input.profileId,
				queryClient: client,
				addition: next,
			}),
	});
	// Admission is a one-time creation step. Expiring mutation history or later
	// membership edits must not put an open conversation back into preparation.
	const confirmed = useRef(false);
	if (addition?.status === "success") {
		confirmed.current = true;
	}
	const ready = !input.members?.length || confirmed.current;
	return {
		ready,
		error:
			addition?.status === "error"
				? "Your Space was created, but the selected members couldn't be confirmed. Your draft is still here."
				: null,
		label: input.spaceId && !ready ? "Adding members…" : "Preparing…",
		retry:
			addition?.status === "error" && addition.input
				? () => {
						if (addition.input) {
							retryAddition.mutate(addition.input);
						}
					}
				: undefined,
	};
}

function CreationMemberRetry(input: { retry: (() => void) | undefined }) {
	return input.retry ? (
		<Button onClick={input.retry} size="sm" variant="outline">
			Retry adding members
		</Button>
	) : null;
}

// Space member actions confirm the acting Human from the account Profiles,
// exactly as the regular Space route provides them, so the handoff opens the
// Space only with both the bootstrap and those Profiles.
function useCreationOpenState(input: {
	bootstrap: { isError: boolean; refetch: () => unknown };
	// Only a confirmed create response can make a Profiles failure an opening
	// failure; before that, the conversation must not claim the Space exists.
	creationFailed: boolean;
	realSpaceId: string | undefined;
	storageScope: string;
}) {
	const profiles = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope: input.storageScope,
		})
	);
	const created = Boolean(input.realSpaceId) && !input.creationFailed;
	const profilesFailed =
		created && profiles.isError && profiles.data === undefined;
	return {
		accountProfiles: profiles.data,
		openFailed: input.bootstrap.isError || profilesFailed,
		retryOpen: () => {
			if (input.bootstrap.isError) {
				input.bootstrap.refetch();
			}
			if (profilesFailed) {
				profiles.refetch();
			}
		},
	};
}

function SpaceCreationConversation(input: {
	creation: Creation;
	profileId: string;
	request: SpaceCreationRequest;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const { storageScope } = useStartFlowState();
	const client = useQueryClient();
	const request = input.request;
	const realSpaceId = input.creation.response?.spaceId;
	const members = useCreationMembers({
		organizationId: organization.id,
		profileId: input.profileId,
		spaceId: realSpaceId,
		members: request.members,
	});
	const [view, setView] = useState<SpaceView>("messages");
	const [queueing, setQueueing] = useState(false);
	const [queueError, setQueueError] = useState<string | null>(null);
	const editor = useRef<SpaceComposerEditorHandle | null>(null);
	const focusFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (focusFrame.current !== null) {
				cancelAnimationFrame(focusFrame.current);
			}
		},
		[]
	);
	const focusKey = [
		"space-creation-focus",
		organization.id,
		input.profileId,
		request.creationId,
	];
	const restoreComposerFocus = useCallback(
		(composer: SpaceComposerEditorHandle) => {
			const selection = client.getQueryData<
				Parameters<SpaceComposerEditorHandle["selectTextRange"]>[0]
			>([
				"space-creation-focus",
				organization.id,
				input.profileId,
				request.creationId,
			]);
			if (selection && document.activeElement === document.body) {
				// Draft migration updates the editor in layout effects. Restore the
				// selection after those updates, unless the person moved focus.
				focusFrame.current = requestAnimationFrame(() => {
					focusFrame.current = null;
					if (document.activeElement === document.body) {
						composer.selectTextRange(selection);
					}
				});
			}
		},
		[client, organization.id, input.profileId, request.creationId]
	);
	useEffect(() => {
		if (editor.current) {
			restoreComposerFocus(editor.current);
		}
	}, [restoreComposerFocus]);
	const finishComposerHandoff = useCallback(
		(composer: SpaceComposerEditorHandle) => {
			restoreComposerFocus(composer);
			client.setQueryData(
				[
					"space-creation-focus",
					organization.id,
					input.profileId,
					request.creationId,
				],
				null
			);
		},
		[
			client,
			organization.id,
			input.profileId,
			request.creationId,
			restoreComposerFocus,
		]
	);
	const sending = useRef(false);
	const scope: ComposerDraftScope | null = storageScope
		? {
				kind: "space",
				ownerAccountId: storageScope,
				profileId: input.profileId,
				spaceId: request.creationId,
			}
		: null;
	const draft = useComposerDraft({ scope });
	const files = useSpaceComposerFiles({
		organizationSlug: organization.slug,
		profileId: input.profileId,
		spaceId: request.creationId,
		deferUpload: true,
	});
	const pendingKey = [
		"space-creation-message",
		organization.id,
		input.profileId,
		request.creationId,
	];
	const pending = useQuery<PendingSpaceMessage | null>({
		queryKey: pendingKey,
		queryFn: () => null,
		enabled: false,
	});
	const bootstrap = useQuery(
		spaceBootstrapQueryOptions({
			spaceId: realSpaceId ?? request.creationId,
			openMeldProfileId: input.profileId,
			enabled: Boolean(realSpaceId),
		})
	);
	const queueMessage = async () => {
		if (sending.current || pending.data || input.creation.status === "error") {
			return;
		}
		sending.current = true;
		setQueueing(true);
		setQueueError(null);
		try {
			const fileDrafts = await files.readFileDrafts();
			if (!(draft.content.text.trim() || fileDrafts.length)) {
				return;
			}
			client.setQueryData<PendingSpaceMessage>(pendingKey, {
				clientMessageId: crypto.randomUUID(),
				createdAtMs: Date.now(),
				text: draft.content.text,
				fileDrafts,
				files: fileDrafts.map((file) => file.file),
			});
		} catch {
			setQueueError("Couldn't prepare your attachments. Try again.");
		} finally {
			sending.current = false;
			setQueueing(false);
		}
	};
	const failed = input.creation.status === "error";
	const { accountProfiles, openFailed, retryOpen } = useCreationOpenState({
		bootstrap,
		creationFailed: failed,
		realSpaceId,
		storageScope,
	});
	const error = creationError(failed, openFailed, queueError) ?? members.error;
	const ready =
		realSpaceId &&
		bootstrap.data &&
		accountProfiles &&
		!queueing &&
		members.ready;
	return (
		<AppSpaceShell
			currentProfileId={input.profileId}
			currentSpaceId={realSpaceId ?? ""}
			defaultModuleSidebarOpen
		>
			{ready ? (
				<SpaceLanding
					accountProfiles={accountProfiles}
					composerDraftMigrationScopes={scope ? [scope] : undefined}
					initialPendingMessage={pending.data}
					initialSpaceView={view}
					onComposerReady={finishComposerHandoff}
					onInitialPendingMessageConsumed={() =>
						client.setQueryData(pendingKey, null)
					}
					orgSlug={organization.slug}
					profileId={input.profileId}
					spaceId={realSpaceId}
				/>
			) : (
				<section
					className="flex h-full min-h-0 flex-1 flex-col"
					data-space-creation-conversation=""
				>
					<SpaceWindowHeader
						navigation={
							<SpaceViewTabs
								activeView={view}
								idPrefix={request.creationId}
								onViewChange={setView}
							/>
						}
						title={request.name}
						titleAdornment={
							<span className="text-muted-foreground text-sm">
								{request.accessMode === "members_only" ? "Invite only" : ""}
							</span>
						}
					/>
					<div
						aria-label="Space conversation"
						className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4"
						role="log"
					>
						<div
							className={cn("space-y-4", !(pending.data || error) && "my-auto")}
							data-space-conversation-content-width=""
						>
							<p
								aria-live="polite"
								className="py-2 text-center text-muted-foreground text-sm"
							>
								{error ?? <TextShimmer as="span">{members.label}</TextShimmer>}
							</p>
							<CreationQueuedMessage
								failed={failed}
								message={pending.data}
								onEdit={() => client.setQueryData(pendingKey, null)}
								view={view}
							/>
							{failed ? (
								<Link
									className="text-sm underline"
									to={buildOrganizationSpacesPath(organization.slug)}
								>
									Check Spaces
								</Link>
							) : null}
							{openFailed ? (
								<Button onClick={retryOpen} size="sm" variant="outline">
									Retry opening
								</Button>
							) : null}
							<CreationMemberRetry retry={members.retry} />
						</div>
					</div>
					{view === "messages" ? (
						<footer
							className="shrink-0 bg-background py-4"
							onBlurCapture={(event) => {
								if (event.relatedTarget) {
									client.setQueryData(focusKey, null);
								}
							}}
						>
							<div data-space-conversation-content-width="">
								<SpaceComposer
									actions={{
										onEditorChange: (change) => {
											if (
												document.activeElement?.getAttribute("role") ===
												"textbox"
											) {
												client.setQueryData(focusKey, change.selection);
											}
											draft.setContent({
												...draft.content,
												text: change.text,
												authoredMentions: change.authoredMentions,
											});
										},
										onSubmit: () => {
											queueMessage();
										},
										onAddFiles: files.addFiles,
										onRemoveFile: files.removeFile,
										onRetryFile: files.retryFile,
										onRetryFileCleanup: files.retryCleanup,
										onRetryFileRestoration: files.retryRestoration,
									}}
									availability={{
										canSendMessage: !failed,
										canUploadFiles: true,
										isSendingMessage: queueing || Boolean(pending.data),
										sendBlocked: failed,
										fileLimitReached: files.isAtLimit,
									}}
									capabilities={{ mentions: false }}
									centerAgentProfileId={null}
									composerRef={editor}
									content={{
										text: draft.content.text,
										authoredMentions: draft.content.authoredMentions,
										addressingTargets: [],
										mentionPickerItems: [],
										files: files.files,
										fileCleanup: files.cleanup,
										fileRestorationError: files.restorationError,
									}}
									context={{
										conversationKind: "space",
										placement: "conversation",
									}}
								/>
							</div>
						</footer>
					) : null}
				</section>
			)}
		</AppSpaceShell>
	);
}

function CreationQueuedMessage(input: {
	message: PendingSpaceMessage | null | undefined;
	failed: boolean;
	view: SpaceView;
	onEdit: () => void;
}) {
	if (!input.message || input.view !== "messages") {
		return null;
	}
	return (
		<div className="ml-auto w-fit max-w-full rounded-xl bg-muted px-4 py-3">
			<p className="whitespace-pre-wrap break-words text-sm">
				{input.message.text}
			</p>
			{input.message.files?.map((file) => (
				<p className="text-sm" key={file.name}>
					{file.name}
				</p>
			))}
			<p className="mt-1 text-muted-foreground text-xs">
				{input.failed ? "Not sent" : "Waiting for Space…"}
			</p>
			<Button onClick={input.onEdit} size="sm" variant="ghost">
				Edit message
			</Button>
		</div>
	);
}
