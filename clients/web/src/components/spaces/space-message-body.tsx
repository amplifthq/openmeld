import type { SpaceApi } from "@openmeld/api-client";
import type { NavigationAction } from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { FileIcon } from "@phosphor-icons/react";
import { QueryClientContext } from "@tanstack/react-query";
import { useReducedMotionConfig } from "framer-motion";
import {
	type ComponentProps,
	lazy,
	memo,
	type ReactNode,
	type Ref,
	Suspense,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { MessageResponse } from "#/components/ai/message-response";
import { DesktopAwareLink } from "#/desktop/desktop-aware-link";
import { getDesktopPlatform } from "#/desktop/platform";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildWebSpaceAttachmentDownloadPath } from "#/lib/spaces/web-space-attachment-path";
import { resolveSpaceFileMediaPresentationKey } from "#/query/spaces/space-files";
import {
	CenterAgentComputerSetupCard,
	type CenterAgentComputerSetupContext,
	type ComputerSetupTarget,
} from "./center-agent-computer-setup-card";
import { Marker, MarkerContent } from "./primitives/marker";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceFileHtmlBadge } from "./space-file-html-badge";
import { downloadUrlContent } from "./space-file-utils";
import { SpaceImagePreview } from "./space-image-preview";
import { SpaceInlineMessageEditor } from "./space-inline-message-editor";
import { collapseSpaceMessage } from "./space-message-collapse";
import { useSpaceMessageEditing } from "./space-message-editing";
import { SpaceMessageLinkPreviews } from "./space-message-link-previews";
import {
	buildSpaceMessageProfileMentionProfiles,
	createSpaceMessageProfileMentionRemarkPlugin,
	EMPTY_SPACE_MESSAGE_PROFILE_MENTION_PROFILES,
	renderSpaceMessageProfileMentionInternalLink,
	type SpaceMessageProfileMentionProfilesById,
	type SpaceProfileTriggerRenderer,
	splitSpaceMessageProfileMentionText,
} from "./space-message-profile-mention";
import {
	SpaceMessageProfileMention,
	SpaceMessageProfileMentionText,
} from "./space-message-profile-mention-view";
import {
	createSpaceMessageReferenceRemarkPlugin,
	EMPTY_SPACE_MESSAGE_REFERENCES,
	renderSpaceMessageInternalLink,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import { SpaceVideoPreview } from "./space-video-preview";
import { useImageFrameActivity } from "./use-image-frame-activity";
import { usePluginConnectionReply } from "./use-plugin-connection-reply";
import { useSpaceFileImageSource } from "./use-space-file-image-source";
import { useSpaceStreamDisplayText } from "./use-space-stream-display-text";

const PluginConnectionMessageCard = lazy(async () => {
	const module = await import(
		"#/components/organizations/plugin-connection-message-card"
	);
	return { default: module.PluginConnectionMessageCard };
});

export const SPACE_RESPONSE_TRUNCATED_MARKER =
	"[Response truncated by OpenMeld]";
export const SPACE_RESPONSE_TRUNCATED_SUFFIX = `\n\n${SPACE_RESPONSE_TRUNCATED_MARKER}`;
const HUMAN_MESSAGE_EXTRA_BLANK_LINES = /(?:\r?\n[ \t]*){3,}/;
const HUMAN_MESSAGE_FENCE_START = /^ {0,3}(`{3,}|~{3,})/;
const HUMAN_MESSAGE_FENCE_END = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/;

type SpaceMessageBodyProps = {
	className?: string;
	computerSetupContext?: CenterAgentComputerSetupContext;
	computerSetupSourceSignalId?: string;
	containerClassName?: string;
	item: Pick<
		SpaceTimelineItem,
		"agentStreamState" | "isAgentFinalReply" | "navigationAction" | "text"
	> &
		Partial<
			Pick<
				SpaceTimelineItem,
				| "actorProfileKind"
				| "id"
				| "messageRevision"
				| "deliveryState"
				| "recalledAt"
				| "repostedAt"
				| "editedAt"
				| "actorProfileId"
				| "actorName"
				| "attachments"
				| "files"
				| "referenceTargetProfileIds"
				| "mentionTargetProfileIds"
				| "spaceId"
				| "wakeTargetProfileIds"
			>
		>;
	onOpenProfile?: (profileId: string) => void;
	renderProfileTrigger?: SpaceProfileTriggerRenderer;
	onOpenSpaceFile?: (fileId: string, revision: number) => void;
	openMeldProfileId?: string;
	orgSlug?: string;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	spaceReferencesById?: SpaceMessageReferencesById;
};

function useSpaceMessageTextPresentation(input: SpaceMessageBodyProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const pluginReply = usePluginConnectionReply({
		final:
			input.item.isAgentFinalReply === true &&
			input.item.agentStreamState?.status !== "streaming",
		organizationSlug: input.orgSlug,
		text: input.item.text,
	});
	const shouldReduceMotion = useReducedMotionConfig();
	const isStreaming = input.item.agentStreamState?.status === "streaming";
	const displayedText = useSpaceStreamDisplayText({
		enabled: isStreaming && shouldReduceMotion !== true,
		streamId: input.item.agentStreamState?.streamId ?? null,
		text: pluginReply?.text ?? input.item.text,
	});
	const textProjection = useMemo(
		() => splitServerTruncationMarker(displayedText),
		[displayedText]
	);
	const isMarkdown =
		input.item.actorProfileKind === "agent" ||
		input.item.isAgentFinalReply === true;
	const visibleText = useMemo(
		() =>
			isMarkdown
				? textProjection.visibleText
				: normalizeHumanMessageBlankLines(textProjection.visibleText),
		[isMarkdown, textProjection.visibleText]
	);
	const collapsedText = useMemo(
		() => collapseSpaceMessage(visibleText, isMarkdown),
		[visibleText, isMarkdown]
	);
	const shouldCollapse = collapsedText !== visibleText;
	const renderedText =
		shouldCollapse && !isExpanded ? collapsedText : visibleText;
	return {
		isExpanded,
		isStreaming,
		pluginAction: pluginReply?.action,
		renderedText,
		setIsExpanded,
		shouldCollapse,
		textProjection,
	};
}

function normalizeHumanMessageBlankLines(text: string): string {
	if (!HUMAN_MESSAGE_EXTRA_BLANK_LINES.test(text)) {
		return text;
	}
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const normalized: string[] = [];
	let fencedWith: string | null = null;
	let hasBlankLine = false;
	for (const line of lines) {
		if (!fencedWith && line.trim() === "") {
			hasBlankLine = true;
			continue;
		}
		if (hasBlankLine) {
			normalized.push("");
			hasBlankLine = false;
		}
		normalized.push(line);
		const marker = line.match(HUMAN_MESSAGE_FENCE_START);
		if (fencedWith) {
			if (
				marker &&
				marker[1][0] === fencedWith[0] &&
				marker[1].length >= fencedWith.length &&
				HUMAN_MESSAGE_FENCE_END.test(line)
			) {
				fencedWith = null;
			}
		} else if (marker) {
			fencedWith = marker[1];
		}
	}
	if (hasBlankLine) {
		normalized.push("");
	}
	return normalized.join("\n");
}

function useSpaceMessageReferencePresentation(input: SpaceMessageBodyProps) {
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const profileMentionProfilesById = useMemo(
		() =>
			buildSpaceMessageProfileMentionProfiles({
				profilePresentationsById:
					input.profilePresentationsById ??
					EMPTY_SPACE_MESSAGE_PROFILE_MENTION_PROFILES,
				referenceTargetProfileIds: input.item.referenceTargetProfileIds ?? [],
				mentionTargetProfileIds: input.item.mentionTargetProfileIds ?? [],
				wakeTargetProfileIds: input.item.wakeTargetProfileIds ?? [],
			}),
		[
			input.item.referenceTargetProfileIds,
			input.item.mentionTargetProfileIds,
			input.item.wakeTargetProfileIds,
			input.profilePresentationsById,
		]
	);
	const additionalRemarkPlugins = useMemo(() => {
		const plugins: NonNullable<
			ComponentProps<typeof MessageResponse>["additionalRemarkPlugins"]
		> = [];
		if (profileMentionProfilesById.size > 0) {
			plugins.push(
				createSpaceMessageProfileMentionRemarkPlugin(profileMentionProfilesById)
			);
		}
		if (spaceReferencesById.size > 0) {
			plugins.push(
				createSpaceMessageReferenceRemarkPlugin(spaceReferencesById)
			);
		}
		return plugins.length > 0 ? plugins : undefined;
	}, [profileMentionProfilesById, spaceReferencesById]);
	const renderInternalLink = useCallback(
		({ children, href }: { children: ReactNode; href: string }) => {
			const profileMention = renderSpaceMessageProfileMentionInternalLink({
				href,
				onOpenProfile: input.onOpenProfile,
				profilesById: profileMentionProfilesById,
				renderProfileTrigger: input.renderProfileTrigger,
			});
			if (profileMention) {
				return profileMention;
			}
			return renderSpaceMessageInternalLink({
				children,
				href,
				referencesById: spaceReferencesById,
			});
		},
		[
			profileMentionProfilesById,
			input.onOpenProfile,
			input.renderProfileTrigger,
			spaceReferencesById,
		]
	);
	return {
		additionalRemarkPlugins,
		profileMentionProfilesById,
		renderInternalLink,
		spaceReferencesById,
	};
}

export const SpaceMessageBody = memo(function SpaceMessageBody(
	input: SpaceMessageBodyProps
) {
	const editing = useSpaceMessageEditing();
	const textPresentation = useSpaceMessageTextPresentation(input);
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const [bodySize, setBodySize] = useState<{
		width: number;
		height: number;
		textHeight: number;
	} | null>(null);
	const isEditing = Boolean(
		input.item.id && editing?.edit?.id === input.item.id
	);
	const canEdit =
		input.item.actorProfileKind === "human" &&
		input.item.actorProfileId === editing?.selfProfileId;
	useLayoutEffect(() => {
		const body = bodyRef.current;
		if (!body || isEditing || !canEdit) {
			return;
		}
		const observer = new ResizeObserver(() => {
			const { width, height } = body.getBoundingClientRect();
			const textHeight =
				body.querySelector(".content-space-message")?.getBoundingClientRect()
					.height ?? height;
			setBodySize((previous) =>
				previous?.width === width &&
				previous.height === height &&
				previous.textHeight === textHeight
					? previous
					: { width, height, textHeight }
			);
		});
		observer.observe(body);
		return () => observer.disconnect();
	}, [isEditing, canEdit]);
	if (input.item.recalledAt) {
		return (
			<Marker
				className="max-w-full gap-2 py-2 text-xs leading-6 before:min-w-6 after:min-w-6"
				data-slot="message-recalled"
				variant="separator"
			>
				<MarkerContent className="flex max-w-[80%] flex-wrap items-center justify-center gap-2 whitespace-normal">
					<span>
						{input.item.actorProfileId === editing?.selfProfileId
							? "You recalled a message."
							: input.item.text}
					</span>
					{editing &&
					!input.item.repostedAt &&
					input.item.actorProfileId === editing.selfProfileId ? (
						<Button
							className={cn(
								surfaceClasses(2),
								"rounded-full text-foreground max-lg:min-h-6 max-lg:min-w-0"
							)}
							disabled={editing.busy}
							onClick={() => editing.restore(input.item as SpaceTimelineItem)}
							size="xs"
							variant="ghost"
						>
							Edit again
						</Button>
					) : null}
				</MarkerContent>
			</Marker>
		);
	}
	if (isEditing && editing?.edit) {
		return (
			<SpaceInlineMessageEditor
				bodySize={bodySize}
				collapseControl={
					<SpaceMessageCollapseButton
						isExpanded={textPresentation.isExpanded}
						onToggle={() =>
							textPresentation.setIsExpanded((expanded) => !expanded)
						}
						visible={textPresentation.shouldCollapse}
					/>
				}
				collapsedHeight={
					textPresentation.shouldCollapse && !textPresentation.isExpanded
						? bodySize?.textHeight
						: undefined
				}
				item={editing.edit}
				key={editing.edit.id}
			/>
		);
	}
	return (
		<SpaceMessageBodyDisplay
			{...input}
			bodyRef={bodyRef}
			textPresentation={textPresentation}
		/>
	);
});

const SpaceMessageBodyDisplay = memo(function SpaceMessageBodyDisplay(
	input: SpaceMessageBodyProps & {
		bodyRef: Ref<HTMLDivElement>;
		textPresentation: ReturnType<typeof useSpaceMessageTextPresentation>;
	}
) {
	const text = input.textPresentation;
	const references = useSpaceMessageReferencePresentation(input);
	const className = cn(
		"break-words content-space-message [overflow-wrap:anywhere]",
		text.shouldCollapse && !text.isExpanded && "fluid-fade-bottom",
		input.className
	);
	const shouldRenderMarkdown =
		input.item.actorProfileKind === "agent" ||
		input.item.isAgentFinalReply === true;
	const navigationAction =
		input.item.isAgentFinalReply === true
			? (input.item.navigationAction ?? text.pluginAction)
			: undefined;
	const navigationActionContent = renderSpaceMessageNavigationAction({
		action: navigationAction,
		continuation:
			input.item.id && input.item.spaceId
				? { sourceSignalId: input.item.id, spaceId: input.item.spaceId }
				: undefined,
		organizationSlug: input.orgSlug,
		computerSetupContext: input.computerSetupContext,
		computerSetupSourceSignalId: input.computerSetupSourceSignalId,
	});
	const attachments = input.item.attachments ?? [];
	const files = input.item.files ?? [];
	const spaceApi = useMemo(() => {
		const createApi = () =>
			input.orgSlug
				? createOrganizationScopedWebSpaceApi({
						openMeldProfileId: input.openMeldProfileId,
						organizationSlug: input.orgSlug,
					})
				: createUnscopedWebSpaceApi({
						openMeldProfileId: input.openMeldProfileId,
					});
		return {
			downloadFileContent: (
				...args: Parameters<SpaceApi["downloadFileContent"]>
			) => createApi().downloadFileContent(...args),
			getLinkPreviews: (...args: Parameters<SpaceApi["getLinkPreviews"]>) =>
				createApi().getLinkPreviews(...args),
		};
	}, [input.openMeldProfileId, input.orgSlug]);
	const body = renderSpaceMessageTextContent({
		additionalRemarkPlugins: references.additionalRemarkPlugins,
		profileMentionProfilesById: references.profileMentionProfilesById,
		className,
		isStreaming: text.isStreaming,
		onOpenProfile: input.onOpenProfile,
		renderProfileTrigger: input.renderProfileTrigger,
		referencesById: references.spaceReferencesById,
		renderInternalLink: references.renderInternalLink,
		renderedText: text.renderedText,
		shouldRenderMarkdown,
	});
	const inlineTargetIds = new Set(
		splitSpaceMessageProfileMentionText(
			text.renderedText,
			references.profileMentionProfilesById
		).flatMap((segment) =>
			segment.kind === "profile_mention" ? [segment.profile.profileId] : []
		)
	);
	const remainingTargets = [
		...references.profileMentionProfilesById.values(),
	].filter((profile) => !inlineTargetIds.has(profile.profileId));
	const addressedBody = remainingTargets.length ? (
		<>
			<div
				className="mb-1 flex flex-wrap items-center gap-1"
				data-slot="space-message-addressing"
			>
				{remainingTargets.map((profile) => (
					<SpaceMessageProfileMention
						key={profile.profileId}
						onOpenProfile={input.onOpenProfile}
						profile={profile}
						renderProfileTrigger={input.renderProfileTrigger}
					/>
				))}
			</div>
			{body}
		</>
	) : (
		body
	);
	const hasVisibleContent =
		addressedBody !== null ||
		Boolean(navigationActionContent) ||
		attachments.length > 0 ||
		files.length > 0 ||
		text.textProjection.serverTruncated;
	if (!hasVisibleContent) {
		return null;
	}

	return (
		<SpaceMessageBodyContent
			api={spaceApi}
			attachments={attachments}
			body={addressedBody}
			bodyRef={input.bodyRef}
			containerClassName={input.containerClassName}
			edited={Boolean(input.item.editedAt)}
			files={files}
			isExpanded={text.isExpanded}
			linkPreviews={
				input.item.id &&
				input.item.spaceId &&
				input.item.deliveryState === "sent" &&
				!input.item.recalledAt &&
				!text.isStreaming ? (
					<SpaceMessageLinkPreviews
						api={spaceApi}
						key={`${input.item.id}:${input.item.messageRevision ?? 0}`}
						revision={input.item.messageRevision ?? 0}
						signalId={input.item.id}
						spaceId={input.item.spaceId}
						text={input.item.text}
						viewerKey={`${input.orgSlug ?? "personal"}:${input.openMeldProfileId ?? "viewer"}`}
					/>
				) : null
			}
			navigationActionContent={navigationActionContent}
			onOpenSpaceFile={input.onOpenSpaceFile}
			onToggleExpanded={() => text.setIsExpanded((current) => !current)}
			organizationSlug={input.orgSlug}
			serverTruncated={text.textProjection.serverTruncated}
			shouldCollapse={text.shouldCollapse}
			spaceId={input.item.spaceId ?? ""}
		/>
	);
});

function SpaceMessageBodyContent(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	attachments: SpaceTimelineItem["attachments"];
	body: ReactNode;
	linkPreviews: ReactNode;
	bodyRef: Ref<HTMLDivElement>;
	edited: boolean;
	containerClassName?: string;
	files: NonNullable<SpaceTimelineItem["files"]>;
	isExpanded: boolean;
	navigationActionContent: ReactNode;
	onOpenSpaceFile?: (fileId: string, revision: number) => void;
	onToggleExpanded: () => void;
	organizationSlug?: string;
	serverTruncated: boolean;
	shouldCollapse: boolean;
	spaceId: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 max-w-full flex-col gap-2",
				input.files.some((file) => file.mimeType.startsWith("video/")) &&
					"w-full",
				input.containerClassName
			)}
			data-slot="space-message-body"
			ref={input.bodyRef}
			style={{ overflowWrap: "anywhere" }}
		>
			{input.body}
			{input.linkPreviews}
			<SpaceMessageCollapseButton
				isExpanded={input.isExpanded}
				onToggle={input.onToggleExpanded}
				visible={input.shouldCollapse}
			/>
			{input.navigationActionContent}

			<SpaceMessageAttachmentGrid
				attachments={input.attachments}
				organizationSlug={input.organizationSlug}
				spaceId={input.spaceId}
			/>
			<SpaceMessageFileList
				api={input.api}
				files={input.files}
				onOpenSpaceFile={input.onOpenSpaceFile}
				organizationSlug={input.organizationSlug}
				spaceId={input.spaceId}
			/>
			<SpaceMessageServerTruncatedNote visible={input.serverTruncated} />
			{input.edited ? (
				<span className="text-muted-foreground text-xs">(edited)</span>
			) : null}
		</div>
	);
}

function SpaceMessageCollapseButton(input: {
	isExpanded: boolean;
	onToggle: () => void;
	visible: boolean;
}) {
	if (!input.visible) {
		return null;
	}
	return (
		<button
			aria-expanded={input.isExpanded}
			className="w-fit text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			onClick={input.onToggle}
			type="button"
		>
			{input.isExpanded ? "Show less" : "Show more"}
		</button>
	);
}

function SpaceMessageServerTruncatedNote(input: { visible: boolean }) {
	if (!input.visible) {
		return null;
	}
	return (
		<p
			className="border-border/60 border-l-2 pl-3 text-muted-foreground text-xs leading-5"
			role="note"
		>
			OpenMeld shortened this reply because it reached the message limit.
		</p>
	);
}

function renderSpaceMessageTextContent(input: {
	additionalRemarkPlugins: ComponentProps<
		typeof MessageResponse
	>["additionalRemarkPlugins"];
	profileMentionProfilesById: SpaceMessageProfileMentionProfilesById;
	className: string;
	isStreaming: boolean;
	onOpenProfile?: (profileId: string) => void;
	renderProfileTrigger?: SpaceProfileTriggerRenderer;
	referencesById: SpaceMessageReferencesById;
	renderInternalLink: ComponentProps<
		typeof MessageResponse
	>["renderInternalLink"];
	renderedText: string;
	shouldRenderMarkdown: boolean;
}): ReactNode {
	if (input.renderedText.trim().length === 0) {
		return null;
	}
	if (input.shouldRenderMarkdown) {
		return (
			<MessageResponse
				additionalRemarkPlugins={input.additionalRemarkPlugins}
				className={input.className}
				isStreaming={input.isStreaming}
				renderInternalLink={input.renderInternalLink}
				variant="space-message"
			>
				{input.renderedText}
			</MessageResponse>
		);
	}
	return (
		<p className={cn("max-w-full whitespace-pre-wrap", input.className)}>
			<SpaceMessageProfileMentionText
				onOpenProfile={input.onOpenProfile}
				profilesById={input.profileMentionProfilesById}
				renderProfileTrigger={input.renderProfileTrigger}
				renderText={(text) => (
					<SpaceMessageReferenceText
						referencesById={input.referencesById}
						text={text}
					/>
				)}
				text={input.renderedText}
			/>
		</p>
	);
}

function renderSpaceMessageNavigationAction(input: {
	action: NavigationAction | null | undefined;
	continuation?: { sourceSignalId: string; spaceId: string };
	organizationSlug: string | undefined;
	computerSetupContext: CenterAgentComputerSetupContext | undefined;
	computerSetupSourceSignalId: string | undefined;
}): ReactNode {
	if (!input.action) {
		return null;
	}
	if (input.action.target.kind === "plugin_connection") {
		return (
			<Suspense
				fallback={
					<DesktopAwareLink href={input.action.url}>
						{input.action.label}
					</DesktopAwareLink>
				}
			>
				<PluginConnectionMessageCard
					action={{ ...input.action, target: input.action.target }}
					continuation={input.continuation}
					organizationSlug={input.organizationSlug}
				/>
			</Suspense>
		);
	}
	if (
		input.computerSetupContext &&
		isComputerSetupNavigationAction(input.action)
	) {
		return (
			<CenterAgentComputerSetupCard
				context={input.computerSetupContext}
				sourceSignalId={input.computerSetupSourceSignalId}
				target={input.action.target}
			/>
		);
	}
	return (
		<DesktopAwareLink
			className={cn(
				buttonVariants({ size: "sm", variant: "outline" }),
				"w-fit"
			)}
			data-slot="navigation-action"
			href={input.action.url}
		>
			{input.action.label}
		</DesktopAwareLink>
	);
}

function isComputerSetupNavigationAction(
	action: NavigationAction
): action is NavigationAction & { target: ComputerSetupTarget } {
	return action.target.kind === "computer_setup";
}

export function SpaceMessageAttachmentGrid(input: {
	attachments: SpaceTimelineItem["attachments"];
	organizationSlug?: string;
	spaceId: string;
}) {
	if (input.attachments.length === 0) {
		return null;
	}

	return (
		<fieldset
			aria-label={`${String(input.attachments.length)} attached ${
				input.attachments.length === 1 ? "image" : "images"
			}`}
			className={cn(
				"m-0 grid w-full max-w-2xl gap-1.5 border-0 p-0",
				input.attachments.length === 1 ? "grid-cols-1" : "grid-cols-2"
			)}
		>
			{input.attachments.map((attachment) => (
				<SpaceMessageAttachmentImage
					attachment={attachment}
					isSingle={input.attachments.length === 1}
					key={attachment.id}
					organizationSlug={input.organizationSlug}
					spaceId={input.spaceId}
				/>
			))}
		</fieldset>
	);
}

export function SpaceMessageFileList(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	files: NonNullable<SpaceTimelineItem["files"]>;
	organizationSlug?: string;
	onOpenSpaceFile?: (fileId: string, revision: number) => void;
	spaceId: string;
}) {
	const queryClient = useContext(QueryClientContext);
	if (input.files.length === 0) {
		return null;
	}
	const imageFiles = input.files.filter((file) =>
		file.mimeType.startsWith("image/")
	);
	const videoFiles = input.files.filter((file) =>
		file.mimeType.startsWith("video/")
	);
	const ordinaryFiles = input.files.filter(
		(file) =>
			!(
				file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/")
			)
	);

	return (
		<>
			{imageFiles.length > 0 ? (
				<fieldset
					aria-label={`${String(imageFiles.length)} shared ${
						imageFiles.length === 1 ? "image" : "images"
					}`}
					className={cn(
						"m-0 grid w-full max-w-2xl gap-1.5 border-0 p-0",
						imageFiles.length === 1 ? "grid-cols-1" : "grid-cols-2"
					)}
				>
					{imageFiles.map((file) => (
						<SpaceMessageFileImage
							api={input.api}
							file={file}
							isSingle={imageFiles.length === 1}
							key={resolveSpaceFileMediaPresentationKey(
								queryClient,
								input.spaceId,
								file
							)}
							onOpenSpaceFile={file.isLocal ? undefined : input.onOpenSpaceFile}
							spaceId={input.spaceId}
						/>
					))}
				</fieldset>
			) : null}
			{videoFiles.length > 0 && (
				<fieldset
					aria-label="Shared videos"
					className="m-0 grid w-full min-w-0 max-w-2xl gap-3 border-0 p-0"
				>
					{videoFiles.map((file) => (
						<SpaceVideoPreview
							fileName={file.name}
							isLocal={file.isLocal}
							key={resolveSpaceFileMediaPresentationKey(
								queryClient,
								input.spaceId,
								file
							)}
							localPreviewUrl={file.localPreviewUrl}
							onOpenFile={
								!file.isLocal && input.onOpenSpaceFile
									? () => input.onOpenSpaceFile?.(file.fileId, file.revision)
									: undefined
							}
							target={{
								spaceId: input.spaceId,
								fileId: file.fileId,
								revision: file.revision,
								organizationSlug: input.organizationSlug,
							}}
						/>
					))}
				</fieldset>
			)}
			{ordinaryFiles.length > 0 ? (
				<fieldset
					aria-label="Shared files"
					className="m-0 grid w-full max-w-2xl gap-2 border-0 p-0"
				>
					{ordinaryFiles.map((file) => (
						<button
							className="group flex min-w-0 items-center gap-3 rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none"
							disabled={file.isLocal}
							key={`${file.fileId}:${String(file.revision)}`}
							onClick={() =>
								input.onOpenSpaceFile?.(file.fileId, file.revision)
							}
							type="button"
						>
							<SpaceMessageFileIcon mimeType={file.mimeType} />
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">{file.name}</p>
								<p className="mt-0.5 truncate text-muted-foreground text-xs">
									{formatMessageFileSize(file.sizeBytes)}
									{file.isLocal ? null : ` · Version ${file.revision}`}
								</p>
							</div>
							<span className="shrink-0 text-muted-foreground text-xs group-hover:text-foreground">
								{file.isLocal ? null : "Open in Files"}
							</span>
						</button>
					))}
				</fieldset>
			) : null}
		</>
	);
}

function SpaceMessageFileIcon(input: { mimeType: string }) {
	return (
		<div className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground">
			{input.mimeType === "text/html" ? (
				<SpaceFileHtmlBadge />
			) : (
				<FileIcon aria-hidden="true" className="size-5" />
			)}
		</div>
	);
}

function SpaceMessageFileImage(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	file: NonNullable<SpaceTimelineItem["files"]>[number];
	isSingle: boolean;
	onOpenSpaceFile?: (fileId: string, revision: number) => void;
	spaceId: string;
}) {
	const activity = useImageFrameActivity();
	const imageSource = useSpaceFileImageSource({
		api: input.api,
		enabled: activity.active,
		fileId: input.file.fileId,
		isLocal: input.file.isLocal,
		localPreviewUrl: input.file.localPreviewUrl,
		mimeType: input.file.mimeType,
		revision: input.file.revision,
		spaceId: input.spaceId,
	});

	return (
		<SpaceImagePreview
			active={activity.active}
			altText={input.file.name}
			error={!imageSource.sourceUrl && Boolean(imageSource.error)}
			focusedAction={
				input.onOpenSpaceFile
					? {
							label: "Open in Files",
							onSelect: () =>
								input.onOpenSpaceFile?.(input.file.fileId, input.file.revision),
						}
					: undefined
			}
			frameRef={activity.frame}
			height={input.file.imageDimensions?.height}
			imageSource={imageSource.sourceUrl}
			isSingle={input.isSingle}
			onRetry={imageSource.retry}
			width={input.file.imageDimensions?.width}
		/>
	);
}

function formatMessageFileSize(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${String(sizeBytes)} B`;
	}
	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(1)} KB`;
	}
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SpaceMessageAttachmentImage(input: {
	attachment: SpaceTimelineItem["attachments"][number];
	isSingle: boolean;
	organizationSlug?: string;
	spaceId: string;
}) {
	const activity = useImageFrameActivity();
	const downloadPath = buildWebSpaceAttachmentDownloadPath({
		attachmentId: input.attachment.id,
		organizationSlug: input.organizationSlug,
		spaceId: input.spaceId,
	});
	const altText = input.attachment.fileName ?? "Attached image";
	const imageSource = input.attachment.localPreviewUrl ?? downloadPath;

	return (
		<SpaceImagePreview
			active={activity.active}
			altText={altText}
			cold={!input.attachment.localPreviewUrl}
			focusedAction={
				getDesktopPlatform()
					? {
							label: "Download original",
							onSelect: () => {
								downloadUrlContent(altText, downloadPath).catch(
									(error: unknown) =>
										toast.error(
											error instanceof Error
												? error.message
												: "Could not download this image. Try again."
										)
								);
							},
						}
					: { href: downloadPath, label: "Open original" }
			}
			frameRef={activity.frame}
			height={input.attachment.height}
			imageSource={imageSource}
			isSingle={input.isSingle}
			width={input.attachment.width}
		/>
	);
}

function splitServerTruncationMarker(text: string): {
	serverTruncated: boolean;
	visibleText: string;
} {
	if (!text.endsWith(SPACE_RESPONSE_TRUNCATED_SUFFIX)) {
		return {
			serverTruncated: false,
			visibleText: text,
		};
	}

	return {
		serverTruncated: true,
		visibleText: text.slice(0, -SPACE_RESPONSE_TRUNCATED_SUFFIX.length),
	};
}
