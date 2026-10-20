import type { SpaceApi } from "@openmeld/api-client";
import type { NavigationAction } from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { useReducedMotionConfig } from "framer-motion";
import {
	type ComponentProps,
	lazy,
	memo,
	type ReactNode,
	type Ref,
	Suspense,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MessageResponse } from "#/components/ai/message-response";
import { DesktopAwareLink } from "#/desktop/desktop-aware-link";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import {
	isStoppedSpaceReply,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import { resolveSpaceMessageStopFeedback } from "#/lib/spaces/wake-progress-presentation";
import {
	CenterAgentComputerSetupCard,
	type CenterAgentComputerSetupContext,
	type ComputerSetupTarget,
} from "./center-agent-computer-setup-card";
import { Marker, MarkerContent } from "./primitives/marker";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceInlineMessageEditor } from "./space-inline-message-editor";
import { SpaceMessageAttachments } from "./space-message-attachments";
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
import {
	taskMessageBodyText,
	useSpaceMessageTask,
} from "./space-task-references";
import { useSpaceWakeStopRequestStatuses } from "./space-wake-stop-control";
import { usePluginConnectionReply } from "./use-plugin-connection-reply";
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
	/** Transcript owners render the same attachment strip outside the text surface. */
	includeAttachments?: boolean;
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
				| "systemNoticeType"
				| "signalType"
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
				| "activeWakeProgress"
				| "wakeClientMessageId"
				| "clientMessageId"
				| "wakeSourceSignalId"
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
			!isStoppedSpaceReply(input.item) &&
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
		linkPreviewText: pluginReply?.text ?? input.item.text,
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
	const nextTextPresentation = useSpaceMessageTextPresentation(input);
	const lastPresentation = useRef({
		id: input.item.id,
		value: nextTextPresentation,
	});
	const stopRequested =
		resolveSpaceMessageStopFeedback(
			input.item,
			useSpaceWakeStopRequestStatuses()
		).length > 0;
	const holdPartialReply =
		input.item.agentStreamState &&
		(stopRequested || input.item.agentStreamState.status === "stopped");
	if (!holdPartialReply || lastPresentation.current.id !== input.item.id) {
		lastPresentation.current = {
			id: input.item.id,
			value: nextTextPresentation,
		};
	}
	const textPresentation = lastPresentation.current.value;
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
	const task = useSpaceMessageTask(input.item.id);
	const references = useSpaceMessageReferencePresentation(input);
	const className = cn(
		"break-words content-space-message [overflow-wrap:anywhere]",
		// A mask clips to its border box; the inline bleed keeps list markers
		// and other side overhang painted while the text stays in place.
		text.shouldCollapse && !text.isExpanded && "fluid-fade-bottom -mx-3 px-3",
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
		sourceSignalId: input.item.id,
		spaceId: input.item.spaceId,
		organizationSlug: input.orgSlug,
		computerSetupContext: input.computerSetupContext,
		computerSetupSourceSignalId: input.computerSetupSourceSignalId,
	});
	const attachments =
		input.includeAttachments === false ? [] : (input.item.attachments ?? []);
	const files =
		input.includeAttachments === false ? [] : (input.item.files ?? []);
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
		renderedText: taskMessageBodyText(
			task,
			input.item.text,
			references.profileMentionProfilesById.size,
			text.renderedText,
			input.includeAttachments === false
		),
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
		isStoppedSpaceReply(input.item) ||
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
			attachments={attachments}
			body={
				<>
					{addressedBody}
					{isStoppedSpaceReply(input.item) ? (
						<p
							className="text-muted-foreground text-xs leading-5"
							data-slot="stopped-reply-status"
						>
							(Request stopped)
						</p>
					) : null}
				</>
			}
			bodyRef={input.bodyRef}
			containerClassName={input.containerClassName}
			edited={
				Boolean(input.item.editedAt) && input.includeAttachments !== false
			}
			files={files}
			isExpanded={text.isExpanded}
			linkPreviews={
				input.item.signalType === "signal.text" &&
				!isStoppedSpaceReply(input.item) &&
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
						text={text.linkPreviewText}
						viewerKey={`${input.orgSlug ?? "personal"}:${input.openMeldProfileId ?? "viewer"}`}
					/>
				) : null
			}
			navigationActionContent={navigationActionContent}
			onOpenSpaceFile={input.onOpenSpaceFile}
			onToggleExpanded={() => text.setIsExpanded((current) => !current)}
			openMeldProfileId={input.openMeldProfileId}
			organizationSlug={input.orgSlug}
			serverTruncated={text.textProjection.serverTruncated}
			shouldCollapse={text.shouldCollapse}
			spaceId={input.item.spaceId ?? ""}
		/>
	);
});

function SpaceMessageBodyContent(input: {
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
	openMeldProfileId?: string;
	organizationSlug?: string;
	serverTruncated: boolean;
	shouldCollapse: boolean;
	spaceId: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 max-w-full flex-col gap-2",
				(input.files.length > 0 || input.attachments.length > 0) && "w-full",
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

			<SpaceMessageAttachments
				item={{ attachments: input.attachments, files: input.files }}
				onOpenSpaceFile={input.onOpenSpaceFile}
				openMeldProfileId={input.openMeldProfileId}
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
	sourceSignalId: string | undefined;
	spaceId: string | undefined;
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
					continuation={
						input.sourceSignalId && input.spaceId
							? { sourceSignalId: input.sourceSignalId, spaceId: input.spaceId }
							: undefined
					}
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
