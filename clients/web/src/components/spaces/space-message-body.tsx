import type { NavigationAction } from "@openmeld/schemas";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	MorphingDialog,
	MorphingDialogClose,
	MorphingDialogContainer,
	MorphingDialogContent,
	MorphingDialogImage,
	MorphingDialogTrigger,
} from "@openmeld/ui/components/morphing-dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import { useReducedMotionConfig } from "framer-motion";
import {
	type ComponentProps,
	memo,
	type ReactNode,
	useCallback,
	useMemo,
	useState,
} from "react";
import { MessageResponse } from "#/components/ai/message-response";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildWebSpaceAttachmentDownloadPath } from "#/lib/spaces/web-space-attachment-path";
import {
	CenterAgentComputerSetupCard,
	type CenterAgentComputerSetupContext,
	type ComputerSetupTarget,
} from "./center-agent-computer-setup-card";
import { SpaceMessageCenterAgentTaskReferences } from "./space-message-center-agent-task-references";
import {
	createSpaceMessageReferenceRemarkPlugin,
	EMPTY_SPACE_MESSAGE_REFERENCES,
	renderSpaceMessageInternalLink,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import { useSpaceStreamDisplayText } from "./use-space-stream-display-text";

export const SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS = 4000;
export const SPACE_RESPONSE_TRUNCATED_MARKER =
	"[Response truncated by OpenMeld]";
export const SPACE_RESPONSE_TRUNCATED_SUFFIX = `\n\n${SPACE_RESPONSE_TRUNCATED_MARKER}`;
export const SpaceMessageBody = memo(function SpaceMessageBody(input: {
	className?: string;
	computerSetupContext?: CenterAgentComputerSetupContext;
	computerSetupSourceSignalId?: string;
	containerClassName?: string;
	item: Pick<
		SpaceTimelineItem,
		| "agentStreamState"
		| "centerAgentTaskReferences"
		| "isAgentFinalReply"
		| "navigationAction"
		| "text"
	> &
		Partial<
			Pick<SpaceTimelineItem, "actorProfileKind" | "attachments" | "spaceId">
		>;
	orgSlug?: string;
	spaceReferencesById?: SpaceMessageReferencesById;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const shouldReduceMotion = useReducedMotionConfig();
	const isStreaming = input.item.agentStreamState?.status === "streaming";
	const displayedText = useSpaceStreamDisplayText({
		enabled: isStreaming && shouldReduceMotion !== true,
		streamId: input.item.agentStreamState?.streamId ?? null,
		text: input.item.text,
	});
	const textProjection = useMemo(
		() => splitServerTruncationMarker(displayedText),
		[displayedText]
	);
	const className = cn(
		"break-words text-sm leading-6 [overflow-wrap:anywhere]",
		input.className
	);
	const shouldCollapse =
		textProjection.visibleText.length >
		SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS;
	const renderedText =
		shouldCollapse && !isExpanded
			? textProjection.visibleText.slice(
					0,
					SPACE_MESSAGE_LOCAL_COLLAPSE_THRESHOLD_CHARS
				)
			: textProjection.visibleText;
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const additionalRemarkPlugins = useMemo(
		() =>
			spaceReferencesById.size > 0
				? [createSpaceMessageReferenceRemarkPlugin(spaceReferencesById)]
				: undefined,
		[spaceReferencesById]
	);
	const renderInternalLink = useCallback(
		({ children, href }: { children: ReactNode; href: string }) =>
			renderSpaceMessageInternalLink({
				children,
				href,
				referencesById: spaceReferencesById,
			}),
		[spaceReferencesById]
	);
	const shouldRenderMarkdown =
		input.item.actorProfileKind === "agent" ||
		input.item.isAgentFinalReply === true;
	const navigationAction =
		input.item.isAgentFinalReply === true
			? input.item.navigationAction
			: undefined;
	const navigationActionContent = renderSpaceMessageNavigationAction({
		action: navigationAction,
		computerSetupContext: input.computerSetupContext,
		computerSetupSourceSignalId: input.computerSetupSourceSignalId,
	});
	const attachments = input.item.attachments ?? [];
	const centerAgentTaskReferences = input.item.centerAgentTaskReferences ?? [];
	const body = renderSpaceMessageTextContent({
		additionalRemarkPlugins,
		className,
		isStreaming,
		referencesById: spaceReferencesById,
		renderInternalLink,
		renderedText,
		shouldRenderMarkdown,
	});
	const hasVisibleContent =
		body !== null ||
		Boolean(navigationActionContent) ||
		centerAgentTaskReferences.length > 0 ||
		attachments.length > 0 ||
		textProjection.serverTruncated;
	if (!hasVisibleContent) {
		return null;
	}

	return (
		<div
			className={cn("flex min-w-0 flex-col gap-2", input.containerClassName)}
			data-slot="space-message-body"
			style={{ overflowWrap: "anywhere" }}
		>
			{body}
			{navigationActionContent}
			{centerAgentTaskReferences.length > 0 ? (
				<SpaceMessageCenterAgentTaskReferences
					references={centerAgentTaskReferences}
				/>
			) : null}
			<SpaceMessageAttachmentGrid
				attachments={attachments}
				organizationSlug={input.orgSlug}
				spaceId={input.item.spaceId ?? ""}
			/>
			{shouldCollapse ? (
				<button
					aria-expanded={isExpanded}
					className="w-fit text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
					onClick={() => setIsExpanded((current) => !current)}
					type="button"
				>
					{isExpanded ? "Show less" : "Show more"}
				</button>
			) : null}
			{textProjection.serverTruncated ? (
				<p
					className="border-border/60 border-l-2 pl-3 text-muted-foreground text-xs leading-5"
					role="note"
				>
					OpenMeld shortened this reply because it reached the message limit.
				</p>
			) : null}
		</div>
	);
});

function renderSpaceMessageTextContent(input: {
	additionalRemarkPlugins: ComponentProps<
		typeof MessageResponse
	>["additionalRemarkPlugins"];
	className: string;
	isStreaming: boolean;
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
			>
				{input.renderedText}
			</MessageResponse>
		);
	}
	return (
		<p className={cn("whitespace-pre-wrap", input.className)}>
			<SpaceMessageReferenceText
				referencesById={input.referencesById}
				text={input.renderedText}
			/>
		</p>
	);
}

function renderSpaceMessageNavigationAction(input: {
	action: NavigationAction | null | undefined;
	computerSetupContext: CenterAgentComputerSetupContext | undefined;
	computerSetupSourceSignalId: string | undefined;
}): ReactNode {
	if (!input.action) {
		return null;
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
		<a
			className={cn(
				buttonVariants({ size: "sm", variant: "outline" }),
				"w-fit"
			)}
			data-slot="navigation-action"
			href={input.action.url}
		>
			{input.action.label}
		</a>
	);
}

function isComputerSetupNavigationAction(
	action: NavigationAction
): action is NavigationAction & { target: ComputerSetupTarget } {
	return action.target.kind === "computer_setup";
}

function SpaceMessageAttachmentGrid(input: {
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

function SpaceMessageAttachmentImage(input: {
	attachment: SpaceTimelineItem["attachments"][number];
	isSingle: boolean;
	organizationSlug?: string;
	spaceId: string;
}) {
	const [isBroken, setIsBroken] = useState(false);
	const downloadPath = buildWebSpaceAttachmentDownloadPath({
		attachmentId: input.attachment.id,
		organizationSlug: input.organizationSlug,
		spaceId: input.spaceId,
	});
	const altText = input.attachment.fileName ?? "Attached image";
	const imageSource = input.attachment.localPreviewUrl ?? downloadPath;

	if (isBroken) {
		return (
			<div
				className={cn(
					"flex min-h-28 w-full items-center justify-center border border-border bg-muted",
					input.isSingle ? "max-h-[32rem]" : "aspect-square"
				)}
			>
				<span className="px-4 text-center text-muted-foreground text-xs">
					Image unavailable
				</span>
			</div>
		);
	}

	return (
		<MorphingDialog
			transition={{ duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }}
		>
			<MorphingDialogTrigger
				aria-label={`Open ${altText}`}
				className={cn(
					"group/image relative flex max-w-full items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
					input.isSingle ? "w-fit" : "aspect-square w-full"
				)}
			>
				<MorphingDialogImage
					alt={altText}
					className={cn(
						"block transition-opacity group-hover/image:opacity-90",
						input.isSingle
							? "h-auto max-h-[32rem] w-auto max-w-full object-contain"
							: "h-full w-full object-cover"
					)}
					decoding="async"
					height={input.attachment.height}
					loading="lazy"
					onError={() => setIsBroken(true)}
					src={imageSource}
					width={input.attachment.width}
				/>
			</MorphingDialogTrigger>
			<MorphingDialogContainer>
				<MorphingDialogContent className="relative">
					<MorphingDialogImage
						alt={altText}
						className="h-auto max-h-[90vh] w-full max-w-[90vw] object-contain"
						height={input.attachment.height}
						src={imageSource}
						width={input.attachment.width}
					/>
					<a
						className="absolute right-3 bottom-3 border border-border bg-background/95 px-3 py-2 font-medium text-foreground text-xs shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
						href={downloadPath}
						rel="noreferrer"
						target="_blank"
					>
						Open original
					</a>
				</MorphingDialogContent>
				<MorphingDialogClose className="fixed top-6 right-6 border border-border bg-background/95 p-1.5 text-foreground hover:bg-muted">
					<XIcon aria-hidden="true" className="size-5" />
				</MorphingDialogClose>
			</MorphingDialogContainer>
		</MorphingDialog>
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
