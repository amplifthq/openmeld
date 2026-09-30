import { buildPublicSpaceEntryPath } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidContextMenuContent } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowBendUpLeftIcon,
	ArrowUUpLeftIcon,
	ChatCircleIcon,
	CheckIcon,
	CheckSquareOffsetIcon,
	CopyIcon,
	DotsThreeIcon,
	InfoIcon,
	PencilSimpleIcon,
	PushPinIcon,
	SmileyIcon,
	TargetIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { copyAppLinkWithFeedback } from "#/lib/copy-app-link";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceDeviceWaitOutcome } from "./space-device-wait-outcome";
import {
	MessageActionTooltip,
	MessageDetailsActionButton,
} from "./space-message-actions";
import { useSpaceMessageEditing } from "./space-message-editing";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";
import {
	MessageReactionIcon,
	type MessageReactionInput,
	MessageReactionPicker,
	MessageReactionViewer,
	type useMessageReactions,
	useMessageReactionsContext,
} from "./space-message-reactions";
import { SpaceMessageTime } from "./space-message-time";
import { useSpaceMessagePinAction } from "./space-pins";
import { SpaceMessageWakeRecommendation } from "./space-wake-recommendation";

export type SpaceMessageFooterAddressingTarget = {
	agentControllerRef: string | null;
	avatarImageUrl: string | null;
	isCenterAgent: boolean;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
};

export function resolveSpaceMessageFooterAddressingTargets(input: {
	item: SpaceTimelineItem;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
}): readonly SpaceMessageFooterAddressingTarget[] {
	return input.item.wakeTargetProfileIds.flatMap((profileId) => {
		const presentation = input.profilePresentationsById.get(profileId);
		return presentation ? [presentation] : [];
	});
}

export function resolveSpaceMessageFooterFailureSummary(input: {
	notices: readonly SpaceTimelineItem[];
	resolveTargetLabel: (targetProfileId: string) => string | null;
}): string | null {
	const failures = input.notices.filter(
		(notice) => notice.systemNoticeType === "terminal_failure"
	);
	if (failures.length === 0) {
		return null;
	}
	if (failures.length > 1) {
		return `${String(failures.length)} agents couldn’t reply`;
	}
	const targetProfileId = failures[0]?.systemNoticeTargetProfileId;
	if (failures[0]?.systemNoticeReasonCode === "wake.device_wait.expired") {
		return "Wait expired. Task did not run.";
	}
	const targetLabel = targetProfileId
		? input.resolveTargetLabel(targetProfileId)
		: null;
	return `${targetLabel ?? "Agent"} couldn’t reply`;
}

type SpaceMessageFooterAction = {
	disabled?: boolean;
	label: string;
	onSelect: () => void;
};

type SpaceMessageFooterDetailsAction = {
	hasProblem: boolean;
	onSelect: () => void;
};

const FOOTER_BUTTON_CLASS_NAME =
	"size-7 border-0 bg-transparent p-1.5 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus-visible:border-0 max-lg:min-h-7 max-lg:min-w-7";

type SpaceMessageFooterProps = {
	item?: SpaceTimelineItem;
	reaction?: MessageReactionInput;
	signalId?: string;
	deviceWaitOutcome?: {
		notices: readonly SpaceTimelineItem[];
		sourceItem: SpaceTimelineItem;
	};
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	align?: "end" | "start";
	details?: SpaceMessageFooterDetailsAction;
	failureSummary?: string | null;
	isDirectMessage?: boolean;
	layout?: "floating" | "inline";
	onCopy?: () => Promise<boolean>;
	reply?: SpaceMessageFooterAction;
	task?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
};

export function SpaceMessageFooter(
	input: Omit<SpaceMessageFooterProps, "reaction">
) {
	const { input: reaction } = useMessageReactionsContext();
	const editing = useSpaceMessageEditing();
	const editableItem =
		input.item &&
		input.item.actorProfileKind === "human" &&
		input.item.actorProfileId === editing?.selfProfileId &&
		input.item.deliveryState === "sent"
			? input.item
			: null;
	if (input.item?.recalledAt) {
		return null;
	}
	if (input.item?.id && editing?.edit?.id === input.item.id) {
		return (
			<div
				className="w-full min-w-0"
				data-slot="message-edit-actions"
				ref={editing.setActionContainer}
			/>
		);
	}
	return (
		<>
			{editableItem ? (
				<SpaceMessageWakeRecommendation
					align={input.align}
					item={editableItem}
				/>
			) : null}
			<SpaceMessageFooterContent
				{...input}
				onEdit={
					editableItem ? () => editing?.beginEdit(editableItem) : undefined
				}
				onRecall={
					editableItem ? () => editing?.recall(editableItem) : undefined
				}
				reaction={reaction}
			/>
		</>
	);
}

function SpaceMessageFooterContent(
	input: SpaceMessageFooterProps & {
		onEdit?: () => void;
		onRecall?: () => void;
	}
) {
	const { state: reactions } = useMessageReactionsContext();
	const hasReactions = Boolean(input.reaction && reactions.groups.length);
	const persistent = Boolean(input.failureSummary || input.details?.hasProblem);
	const detailsButton = (
		<MessageFooterDetailsAction
			details={input.details}
			failureSummary={input.failureSummary}
		/>
	);

	return (
		<>
			<MessageFooterActions
				detailsButton={detailsButton}
				hasReactions={hasReactions}
				input={input}
				persistent={persistent}
				reactions={reactions}
			/>
			{reactions.error ? (
				<output className="text-destructive text-xs">
					{reactions.error}{" "}
					<button className="underline" onClick={reactions.retry} type="button">
						Refresh
					</button>
				</output>
			) : null}
			{input.reaction ? (
				<MessageReactionViewer input={input.reaction} state={reactions} />
			) : null}
		</>
	);
}

type ToolbarPosition = {
	left: number;
	placement: "after" | "before" | "overlay";
	top: number;
};

export function resolveToolbarPosition(input: {
	bubble: DOMRect;
	container: DOMRect;
	preferredSide: "after" | "before";
	toolbar: DOMRect;
	viewport?: DOMRect;
}): ToolbarPosition {
	const { bubble, container, preferredSide, toolbar, viewport } = input;
	const edgeOverlap = 10;
	const visibleBottom = viewport
		? Math.min(bubble.bottom, viewport.bottom)
		: bubble.bottom;
	const verticalTop = (initialTop: number, bottomOverlap: number) => {
		if (!viewport) {
			return initialTop - container.top;
		}
		const lowerEdgeTop = Math.min(
			visibleBottom - toolbar.height + bottomOverlap,
			viewport.bottom - toolbar.height - 8
		);
		return initialTop + toolbar.height <= viewport.top + 8 &&
			lowerEdgeTop >= viewport.top + 8
			? lowerEdgeTop - container.top
			: initialTop - container.top;
	};
	for (const side of [
		preferredSide,
		preferredSide === "after" ? "before" : "after",
	] as const) {
		const available =
			side === "after"
				? container.right - bubble.right
				: bubble.left - container.left;
		if (available >= toolbar.width + 6) {
			return {
				left:
					side === "after"
						? bubble.right - container.left + 6
						: bubble.left - container.left - toolbar.width - 6,
				placement: side,
				top: verticalTop(bubble.top, 0),
			};
		}
	}
	return {
		left: Math.max(
			0,
			Math.min(
				container.width - toolbar.width,
				preferredSide === "before"
					? bubble.left - container.left - toolbar.width + 12
					: bubble.right - container.left - 12
			)
		),
		placement: "overlay",
		top: verticalTop(
			bubble.top - toolbar.height + edgeOverlap,
			toolbar.height - edgeOverlap
		),
	};
}

function MessageFooterActions({
	input,
	reactions,
	persistent,
	hasReactions,
	detailsButton,
}: {
	input: SpaceMessageFooterProps & {
		onEdit?: () => void;
		onRecall?: () => void;
	};
	reactions: ReturnType<typeof useMessageReactions>;
	persistent: boolean;
	hasReactions: boolean;
	detailsButton: ReactNode;
}) {
	const showPicker = input.reaction && !input.reaction.readOnly;
	const pending = input.item?.deliveryState === "pending";
	const inline = input.layout === "inline";
	const hasMessageText = Boolean(input.item?.text.trim());
	const toolbarRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (inline) {
			return;
		}
		const toolbar = toolbarRef.current;
		const row = toolbar?.closest<HTMLElement>("[data-message-row-id]");
		const bubble = row?.querySelector<HTMLElement>(
			"[data-slot='bubble-content']"
		);
		const attachmentStrip = bubble?.querySelector<HTMLElement>(
			"[data-slot='space-attachment-strip']"
		);
		const attachmentViewport = attachmentStrip?.querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]'
		);
		const container = row;
		const viewport = row?.closest<HTMLElement>(
			'[data-slot="message-scroller-viewport"]'
		);
		if (!(toolbar && row && bubble && container instanceof HTMLElement)) {
			return;
		}
		let observer: ResizeObserver | null = null;
		const position = () => {
			const toolbarRect = toolbar.getBoundingClientRect();
			const textSurface = bubble.querySelector<HTMLElement>(
				"[data-slot='space-message-text-surface']"
			);
			const preferredSide =
				row.closest('[data-space-self-message="true"]') &&
				document.documentElement.dataset.spaceSelfMessageAlignment === "right"
					? "before"
					: "after";
			const attachmentItems = attachmentStrip?.querySelector(
				".space-attachment-strip-items"
			);
			const attachmentViewportRect =
				attachmentViewport?.getBoundingClientRect();
			const visibleAttachmentPreviews = Array.from(
				attachmentItems?.children ?? []
			).filter((preview) => {
				const rect = preview.getBoundingClientRect();
				return (
					!attachmentViewportRect ||
					(rect.right > attachmentViewportRect.left &&
						rect.left < attachmentViewportRect.right)
				);
			});
			const attachmentPreview =
				preferredSide === "before"
					? visibleAttachmentPreviews[0]
					: visibleAttachmentPreviews.at(-1);
			const anchor =
				hasMessageText && textSurface?.getClientRects().length
					? textSurface.getBoundingClientRect()
					: (
							attachmentPreview ??
							attachmentStrip ??
							bubble
						).getBoundingClientRect();
			const next = resolveToolbarPosition({
				bubble: anchor,
				container: container.getBoundingClientRect(),
				preferredSide,
				toolbar: toolbarRect,
				viewport: viewport?.getBoundingClientRect(),
			});
			toolbar.style.insetInlineStart = `${next.left}px`;
			toolbar.style.insetBlockStart = `${next.top}px`;
			toolbar.dataset.placement = next.placement;
		};
		const activate = () => {
			position();
			if (!observer) {
				observer = new ResizeObserver(position);
				observer.observe(container);
				observer.observe(bubble);
				if (attachmentStrip) {
					observer.observe(attachmentStrip);
				}
				viewport?.addEventListener("scroll", position, { passive: true });
				attachmentViewport?.addEventListener("scroll", position, {
					passive: true,
				});
				window.addEventListener("resize", position);
			}
		};
		const deactivate = () => {
			if (
				persistent ||
				row.matches(":hover") ||
				row.contains(document.activeElement)
			) {
				return;
			}
			observer?.disconnect();
			observer = null;
			viewport?.removeEventListener("scroll", position);
			attachmentViewport?.removeEventListener("scroll", position);
			window.removeEventListener("resize", position);
		};
		const onFocusOut = () => queueMicrotask(deactivate);
		row.addEventListener("pointerenter", activate);
		row.addEventListener("pointerleave", deactivate);
		row.addEventListener("focusin", activate);
		row.addEventListener("focusout", onFocusOut);
		if (persistent || window.matchMedia?.("(pointer: coarse)").matches) {
			activate();
		}
		return () => {
			row.removeEventListener("pointerenter", activate);
			row.removeEventListener("pointerleave", deactivate);
			row.removeEventListener("focusin", activate);
			row.removeEventListener("focusout", onFocusOut);
			observer?.disconnect();
			viewport?.removeEventListener("scroll", position);
			attachmentViewport?.removeEventListener("scroll", position);
			window.removeEventListener("resize", position);
		};
	}, [hasMessageText, inline, persistent]);
	return (
		<div
			className={cn(
				"pointer-events-none z-20 flex h-7 w-max max-w-full items-center rounded-md border border-border bg-popover opacity-0 shadow-sm group-focus-within/message-row:pointer-events-auto group-focus-within/message-row:opacity-100 group-hover/message-row:pointer-events-auto group-hover/message-row:opacity-100 has-[[aria-haspopup][aria-expanded=true]]:pointer-events-auto has-[[aria-haspopup][aria-expanded=true]]:opacity-100 [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100",
				inline ? "relative mt-1" : "absolute",
				persistent && "pointer-events-auto opacity-100",
				persistent && "gap-2"
			)}
			data-layout={inline ? "inline" : "floating"}
			data-persistent={persistent ? "true" : undefined}
			data-slot="message-footer"
			ref={toolbarRef}
		>
			<div
				className={cn(
					"flex min-w-0 max-w-full shrink-0 items-center text-muted-foreground text-xs"
				)}
				data-slot="message-footer-primary-actions"
			>
				{input.deviceWaitOutcome ? (
					<SpaceDeviceWaitOutcome {...input.deviceWaitOutcome} />
				) : null}
				{pending ? (
					<MessageFooterIconAction
						disabled
						icon={<MessageReactionIcon />}
						label="Add reaction after sending"
						onSelect={() => undefined}
					/>
				) : null}
				{showPicker && !pending ? (
					<MessageReactionPicker
						buttonClassName={FOOTER_BUTTON_CLASS_NAME}
						state={reactions}
					/>
				) : null}
				{persistent ? detailsButton : null}

				{persistent ? null : (
					<span
						className="contents"
						data-slot="message-footer-standard-actions"
					>
						<MessageFooterStandardActions input={input} />
					</span>
				)}
				<MessageFooterOverflowActions
					hasReactions={hasReactions}
					input={input}
					onAddReaction={
						showPicker && !pending
							? () => reactions.setPickerOpen(true)
							: undefined
					}
					persistent={persistent}
					reactions={reactions}
					toolbarRef={toolbarRef}
				/>
				{input.item ? (
					<SpaceMessageTime
						createdAtMs={input.item.createdAtMs}
						isDirectMessage={input.isDirectMessage === true}
						placement="toolbar"
					/>
				) : null}
			</div>
		</div>
	);
}

function MessageFooterOverflowActions({
	onAddReaction,
	input,
	reactions,
	persistent,
	hasReactions,
	toolbarRef,
}: {
	onAddReaction?: () => void;
	input: SpaceMessageFooterProps & {
		onEdit?: () => void;
		onRecall?: () => void;
	};
	reactions: ReturnType<typeof useMessageReactions>;
	persistent: boolean;
	hasReactions: boolean;
	toolbarRef: RefObject<HTMLDivElement | null>;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [showToolbarActionsInMenu, setShowToolbarActionsInMenu] =
		useState(false);
	const pin = useSpaceMessagePinAction(input.signalId);
	const item = input.item;
	const hasOverflowActions =
		hasReactions ||
		Boolean(
			input.onEdit ||
				pin ||
				input.task ||
				input.details ||
				input.addressingTargets.length
		) ||
		persistent ||
		Boolean(input.onCopy || input.reply || input.thread);

	return hasOverflowActions ? (
		<MessageFooterMoreMenu
			addressingTargets={input.addressingTargets}
			details={input.details}
			edit={input.onEdit}
			hideDetailsInDropdown={persistent}
			onAddReaction={onAddReaction}
			onCopy={input.onCopy}
			onCopyLink={
				item
					? () =>
							copyAppLinkWithFeedback(
								buildPublicSpaceEntryPath({
									spaceId: item.spaceId,
									signalId: item.id,
								})
							)
					: undefined
			}
			onOpenChange={(open) => {
				if (open) {
					const standardActions =
						toolbarRef.current?.querySelector<HTMLElement>(
							'[data-slot="message-footer-standard-actions"]'
						);
					setShowToolbarActionsInMenu(
						persistent ||
							!standardActions ||
							getComputedStyle(standardActions).display === "none"
					);
				}
				setMenuOpen(open);
			}}
			onViewReactions={
				hasReactions ? () => reactions.setViewerOpen(true) : undefined
			}
			open={menuOpen}
			pin={pin}
			recall={input.onRecall}
			reply={input.reply}
			showToolbarActions={showToolbarActionsInMenu}
			task={input.task}
			thread={input.thread}
		/>
	) : null;
}

function MessageFooterStandardActions({
	input,
}: {
	input: SpaceMessageFooterProps & {
		onEdit?: () => void;
		onRecall?: () => void;
	};
}) {
	return (
		<>
			{input.onCopy ? <MessageFooterCopyAction onCopy={input.onCopy} /> : null}
			{input.reply ? (
				<MessageFooterIconAction
					disabled={input.reply.disabled}
					icon={<ArrowBendUpLeftIcon aria-hidden="true" />}
					label={input.reply.label}
					onSelect={input.reply.onSelect}
				/>
			) : null}
			{input.thread ? (
				<MessageFooterIconAction
					disabled={input.thread.disabled}
					icon={<ChatCircleIcon aria-hidden="true" />}
					label={input.thread.label}
					onSelect={input.thread.onSelect}
				/>
			) : null}
		</>
	);
}

function MessageFooterDetailsAction(input: {
	details?: SpaceMessageFooterDetailsAction;
	failureSummary?: string | null;
}) {
	if (input.details) {
		return (
			<MessageDetailsActionButton
				buttonClassName={FOOTER_BUTTON_CLASS_NAME}
				hasWakeProblem={
					Boolean(input.failureSummary) || input.details.hasProblem
				}
				label={
					input.failureSummary
						? `View error details: ${input.failureSummary}`
						: undefined
				}
				onClick={input.details.onSelect}
			/>
		);
	}
	return input.failureSummary ? (
		<WarningCircleIcon
			aria-label={input.failureSummary}
			className="mx-1.5 size-4 text-destructive"
			role="img"
		/>
	) : null;
}

function MessageFooterCopyAction(input: { onCopy: () => Promise<boolean> }) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (resetTimer.current) {
				clearTimeout(resetTimer.current);
			}
		},
		[]
	);
	const label = copied ? "Copied" : "Copy message";
	return (
		<MessageActionTooltip label={label}>
			<Button
				aria-label={label}
				className={FOOTER_BUTTON_CLASS_NAME}
				onClick={async () => {
					if (!(await input.onCopy().catch(() => false))) {
						return;
					}
					setCopied(true);
					if (resetTimer.current) {
						clearTimeout(resetTimer.current);
					}
					resetTimer.current = setTimeout(() => setCopied(false), 2000);
				}}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<span className="relative block size-4">
					<CopyIcon
						aria-hidden="true"
						className={cn(
							"absolute inset-0 size-4 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none motion-reduce:transition-opacity",
							copied ? "scale-95 opacity-0" : "opacity-100"
						)}
					/>
					<CheckIcon
						aria-hidden="true"
						className={cn(
							"absolute inset-0 size-4 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none motion-reduce:transition-opacity",
							copied ? "opacity-100" : "scale-95 opacity-0"
						)}
					/>
				</span>
			</Button>
		</MessageActionTooltip>
	);
}

function MessageFooterIconAction(input: {
	className?: string;
	disabled?: boolean;
	icon: ReactNode;
	label: string;
	onSelect: () => void;
}) {
	return (
		<MessageActionTooltip label={input.label}>
			<Button
				aria-label={input.label}
				className={cn(FOOTER_BUTTON_CLASS_NAME, input.className)}
				disabled={input.disabled}
				onClick={input.onSelect}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				{input.icon}
			</Button>
		</MessageActionTooltip>
	);
}

type MessageFooterMoreMenuProps = {
	onAddReaction?: () => void;
	hideDetailsInDropdown?: boolean;
	details?: SpaceMessageFooterDetailsAction;
	edit?: () => void;
	recall?: () => void;
	onViewReactions?: () => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pin?: SpaceMessageFooterAction;
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	onCopy?: () => Promise<boolean>;
	onCopyLink?: () => Promise<void>;
	reply?: SpaceMessageFooterAction;
	showToolbarActions: boolean;
	thread?: SpaceMessageFooterAction;
	task?: SpaceMessageFooterAction;
};

function resolveMessageFooterMoreActionIds(input: MessageFooterMoreMenuProps) {
	return [
		input.edit && "edit",
		input.pin && "pin",
		input.onViewReactions && "reactions",
		input.showToolbarActions && input.onCopy && "copy",
		input.details && "details",
		input.showToolbarActions && input.reply && "reply",
		input.showToolbarActions && input.thread && "thread",
		input.task && "task",
		input.recall && "recall",
	].filter(Boolean);
}

function MessageFooterMoreMenu(input: MessageFooterMoreMenuProps) {
	return (
		<>
			<DropdownMenu onOpenChange={input.onOpenChange} open={input.open}>
				<MessageActionTooltip label="More actions">
					<DropdownMenuTrigger
						aria-label="More actions"
						className={FOOTER_BUTTON_CLASS_NAME}
						render={<Button size="icon-sm" type="button" variant="ghost" />}
					>
						<DotsThreeIcon aria-hidden="true" />
					</DropdownMenuTrigger>
				</MessageActionTooltip>
				<FluidDropdownMenuContent align="start" className="w-52" sideOffset={6}>
					<MessageFooterMoreMenuItems
						{...input}
						details={input.hideDetailsInDropdown ? undefined : input.details}
					/>
				</FluidDropdownMenuContent>
			</DropdownMenu>
			<FluidContextMenuContent className="w-56">
				<MessageFooterMoreMenuItems {...input} showToolbarActions />
			</FluidContextMenuContent>
		</>
	);
}

function MessageFooterMoreMenuItems(
	input: Parameters<typeof MessageFooterMoreMenu>[0]
) {
	const actionIds = resolveMessageFooterMoreActionIds(input);
	return (
		<DropdownMenuGroup className="flex w-full flex-col">
			{input.showToolbarActions && input.onAddReaction ? (
				<FluidDropdownMenuItem index={-3} onClick={input.onAddReaction}>
					<SmileyIcon aria-hidden="true" />
					Add reaction
				</FluidDropdownMenuItem>
			) : null}
			{input.onCopyLink && (
				<FluidDropdownMenuItem index={-1} onClick={input.onCopyLink}>
					<CopyIcon aria-hidden="true" />
					Copy link
				</FluidDropdownMenuItem>
			)}
			{input.edit ? (
				<FluidDropdownMenuItem
					className="w-full"
					index={actionIds.indexOf("edit")}
					onClick={input.edit}
				>
					<PencilSimpleIcon aria-hidden="true" />
					Edit message
				</FluidDropdownMenuItem>
			) : null}
			{input.pin ? (
				<FluidDropdownMenuItem
					disabled={input.pin.disabled}
					index={actionIds.indexOf("pin")}
					onClick={input.pin.onSelect}
				>
					<PushPinIcon aria-hidden="true" />
					{input.pin.label}
				</FluidDropdownMenuItem>
			) : null}
			{input.onViewReactions ? (
				<FluidDropdownMenuItem
					index={actionIds.indexOf("reactions")}
					onClick={input.onViewReactions}
				>
					<SmileyIcon aria-hidden="true" />
					View reactions
				</FluidDropdownMenuItem>
			) : null}
			{input.showToolbarActions && input.onCopy ? (
				<FluidDropdownMenuItem
					index={actionIds.indexOf("copy")}
					onClick={input.onCopy}
				>
					<CopyIcon aria-hidden="true" />
					Copy message
				</FluidDropdownMenuItem>
			) : null}
			{input.details ? (
				<FluidDropdownMenuItem
					index={actionIds.indexOf("details")}
					onClick={input.details.onSelect}
				>
					<InfoIcon aria-hidden="true" />
					Message details
				</FluidDropdownMenuItem>
			) : null}
			{input.showToolbarActions && input.reply ? (
				<FluidDropdownMenuItem
					disabled={input.reply.disabled}
					index={actionIds.indexOf("reply")}
					onClick={input.reply.onSelect}
				>
					<ArrowBendUpLeftIcon aria-hidden="true" />
					{input.reply.label}
				</FluidDropdownMenuItem>
			) : null}
			{input.showToolbarActions && input.thread ? (
				<FluidDropdownMenuItem
					disabled={input.thread.disabled}
					index={actionIds.indexOf("thread")}
					onClick={input.thread.onSelect}
				>
					<ChatCircleIcon aria-hidden="true" />
					{input.thread.label}
				</FluidDropdownMenuItem>
			) : null}
			{input.task ? (
				<FluidDropdownMenuItem
					disabled={input.task.disabled}
					index={actionIds.indexOf("task")}
					onClick={input.task.onSelect}
				>
					<CheckSquareOffsetIcon aria-hidden="true" />
					{input.task.label}
				</FluidDropdownMenuItem>
			) : null}
			{input.addressingTargets.length > 0 ? (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<TargetIcon aria-hidden="true" />
						Message addressing
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="w-64">
						<MessageAddressingTargetList targets={input.addressingTargets} />
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			) : null}
			{input.recall ? (
				<FluidDropdownMenuItem
					className="w-full"
					index={actionIds.indexOf("recall")}
					onClick={input.recall}
					variant="destructive"
				>
					<ArrowUUpLeftIcon aria-hidden="true" />
					Recall message
				</FluidDropdownMenuItem>
			) : null}
		</DropdownMenuGroup>
	);
}

function MessageAddressingTargetList(input: {
	targets: readonly SpaceMessageFooterAddressingTarget[];
}) {
	return (
		<div className="flex flex-col gap-2" data-slot="message-addressing-targets">
			<p className="font-medium text-muted-foreground text-xs">Woke</p>
			{input.targets.map((target) => (
				<div className="flex min-w-0 items-center gap-2" key={target.profileId}>
					<SpaceMessageProfileAvatar
						agentControllerRef={target.agentControllerRef}
						avatarImageUrl={target.avatarImageUrl}
						displayName={target.profileName}
						isCenterAgent={target.isCenterAgent}
						profileId={target.profileId}
						profileKind={target.profileKind}
					/>
					<span className="min-w-0 truncate font-medium text-foreground text-sm">
						{target.profileName}
					</span>
				</div>
			))}
		</div>
	);
}
