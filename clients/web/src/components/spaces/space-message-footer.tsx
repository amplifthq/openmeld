import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowBendUpLeftIcon,
	ArrowUUpLeftIcon,
	ChatCircleIcon,
	CopyIcon,
	DotsThreeIcon,
	PencilSimpleIcon,
	PushPinIcon,
	SmileyIcon,
	TargetIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
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
	onCopy: () => void;
	copyDisabled?: boolean;
	reply?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
	timestamp: string;
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
	const persistent = Boolean(input.failureSummary);
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
	return (
		<div
			className={cn(
				"@container mt-0.5 flex min-h-7 w-full min-w-0 max-w-full items-center gap-x-1",
				input.align === "end" ? "justify-end" : "justify-start",
				persistent && "gap-2"
			)}
			data-persistent={persistent ? "true" : undefined}
			data-slot="message-footer"
		>
			<div
				className={cn(
					"flex min-w-0 max-w-full shrink-0 items-center gap-0.5 text-muted-foreground text-xs opacity-0 transition-opacity duration-100 ease-out group-focus-within/message-row:pointer-events-auto group-focus-within/message-row:opacity-100 group-hover/message-row:pointer-events-auto group-hover/message-row:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100",
					"has-[[aria-haspopup][aria-expanded=true]]:pointer-events-auto has-[[aria-haspopup][aria-expanded=true]]:opacity-100",
					persistent && "pointer-events-auto opacity-100"
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

				{persistent ? null : <MessageFooterStandardActions input={input} />}
				{persistent ? null : detailsButton}
				<MessageFooterOverflowActions
					hasReactions={hasReactions}
					input={input}
					persistent={persistent}
					reactions={reactions}
				/>
				<time className="ml-1 @max-[24rem]:hidden shrink-0 tabular-nums">
					{input.timestamp}
				</time>
			</div>
		</div>
	);
}

function MessageFooterOverflowActions({
	input,
	reactions,
	persistent,
	hasReactions,
}: {
	input: SpaceMessageFooterProps & {
		onEdit?: () => void;
		onRecall?: () => void;
	};
	reactions: ReturnType<typeof useMessageReactions>;
	persistent: boolean;
	hasReactions: boolean;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const pin = useSpaceMessagePinAction(input.signalId);
	const hasOverflowActions =
		hasReactions || Boolean(input.onEdit || pin) || persistent;

	return hasOverflowActions ? (
		<MessageFooterMoreMenu
			addressingTargets={persistent ? input.addressingTargets : []}
			alwaysVisible={persistent || hasReactions || Boolean(input.onEdit || pin)}
			edit={input.onEdit}
			onCopy={persistent && !input.copyDisabled ? input.onCopy : undefined}
			onOpenChange={setMenuOpen}
			onViewReactions={
				hasReactions ? () => reactions.setViewerOpen(true) : undefined
			}
			open={menuOpen}
			pin={pin}
			recall={input.onRecall}
			reply={persistent ? input.reply : undefined}
			thread={persistent ? input.thread : undefined}
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
			{" "}
			{
				<MessageFooterIconAction
					disabled={input.copyDisabled}
					icon={<CopyIcon aria-hidden="true" />}
					label="Copy message"
					onSelect={input.onCopy}
				/>
			}
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
			{input.addressingTargets.length > 0 ? (
				<MessageAddressingPopover targets={input.addressingTargets} />
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

function MessageAddressingPopover(input: {
	className?: string;
	targets: readonly SpaceMessageFooterAddressingTarget[];
}) {
	return (
		<Popover>
			<MessageActionTooltip label="Message addressing">
				<PopoverTrigger
					aria-label="Message addressing"
					className={cn(FOOTER_BUTTON_CLASS_NAME, input.className)}
					render={<Button size="icon-sm" type="button" variant="ghost" />}
				>
					<TargetIcon aria-hidden="true" />
				</PopoverTrigger>
			</MessageActionTooltip>
			<PopoverContent align="start" className="w-64 rounded-md" sideOffset={6}>
				<PopoverTitle>Message addressing</PopoverTitle>
				<MessageAddressingTargetList targets={input.targets} />
			</PopoverContent>
		</Popover>
	);
}

function MessageFooterMoreMenu(input: {
	edit?: () => void;
	recall?: () => void;
	onViewReactions?: () => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pin?: SpaceMessageFooterAction;
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	alwaysVisible?: boolean;
	onCopy?: () => void;
	reply?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
}) {
	const actionIds = [
		input.pin && "pin",
		input.edit && "edit",
		input.onViewReactions && "reactions",
		input.onCopy && "copy",
		input.reply && "reply",
		input.thread && "thread",
		input.recall && "recall",
	].filter(Boolean);
	return (
		<DropdownMenu onOpenChange={input.onOpenChange} open={input.open}>
			<MessageActionTooltip label="More actions">
				<DropdownMenuTrigger
					aria-label="More actions"
					className={cn(
						FOOTER_BUTTON_CLASS_NAME,
						input.alwaysVisible || input.pin ? null : "@min-[36rem]:hidden"
					)}
					render={<Button size="icon-sm" type="button" variant="ghost" />}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
			</MessageActionTooltip>
			<FluidDropdownMenuContent align="start" className="w-52" sideOffset={6}>
				<DropdownMenuGroup className="flex w-full flex-col">
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
					{input.onViewReactions ? (
						<FluidDropdownMenuItem
							index={actionIds.indexOf("reactions")}
							onClick={input.onViewReactions}
						>
							<SmileyIcon aria-hidden="true" />
							View reactions
						</FluidDropdownMenuItem>
					) : null}
					{input.onCopy ? (
						<FluidDropdownMenuItem
							index={actionIds.indexOf("copy")}
							onClick={input.onCopy}
						>
							<CopyIcon aria-hidden="true" />
							Copy message
						</FluidDropdownMenuItem>
					) : null}
					{input.reply ? (
						<FluidDropdownMenuItem
							disabled={input.reply.disabled}
							index={actionIds.indexOf("reply")}
							onClick={input.reply.onSelect}
						>
							<ArrowBendUpLeftIcon aria-hidden="true" />
							{input.reply.label}
						</FluidDropdownMenuItem>
					) : null}
					{input.thread ? (
						<FluidDropdownMenuItem
							disabled={input.thread.disabled}
							index={actionIds.indexOf("thread")}
							onClick={input.thread.onSelect}
						>
							<ChatCircleIcon aria-hidden="true" />
							{input.thread.label}
						</FluidDropdownMenuItem>
					) : null}
					{input.addressingTargets.length > 0 ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<TargetIcon aria-hidden="true" />
								Message addressing
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="w-64">
								<MessageAddressingTargetList
									targets={input.addressingTargets}
								/>
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
			</FluidDropdownMenuContent>
		</DropdownMenu>
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
