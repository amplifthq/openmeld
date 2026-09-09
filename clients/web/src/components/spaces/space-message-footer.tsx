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
	ChatCircleIcon,
	CopyIcon,
	DotsThreeIcon,
	PushPinIcon,
	TargetIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import {
	MessageActionTooltip,
	MessageDetailsActionButton,
} from "./space-message-actions";
import { useSpaceMessagePinAction } from "./space-message-pins";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";

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

export function SpaceMessageFooter(input: {
	signalId?: string;
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	align?: "end" | "start";
	details?: SpaceMessageFooterDetailsAction;
	failureSummary?: string | null;
	onCopy: () => void;
	copyDisabled?: boolean;
	reply?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
	timestamp: string;
}) {
	const persistent = Boolean(input.failureSummary);
	const [menuOpen, setMenuOpen] = useState(false);
	const pin = useSpaceMessagePinAction(input.signalId);
	const hasOverflowActions = persistent || Boolean(pin);
	const overflowActions = persistent
		? {
				addressingTargets: input.addressingTargets,
				onCopy: input.copyDisabled ? undefined : input.onCopy,
				reply: input.reply,
				thread: input.thread,
			}
		: { addressingTargets: [] };
	const detailsButton = (
		<MessageFooterDetailsAction
			details={input.details}
			failureSummary={input.failureSummary}
		/>
	);

	return (
		<div
			className={cn(
				"@container mt-0.5 flex min-h-7 w-full min-w-0 items-center",
				input.align === "end" ? "justify-end" : "justify-start",
				persistent && "gap-2"
			)}
			data-persistent={persistent ? "true" : undefined}
			data-slot="message-footer"
		>
			<div
				className={cn(
					"flex min-w-0 max-w-full items-center gap-0.5 text-muted-foreground text-xs opacity-0 transition-opacity duration-100 ease-out group-focus-within/message-row:pointer-events-auto group-focus-within/message-row:opacity-100 group-hover/message-row:pointer-events-auto group-hover/message-row:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:pointer-events-auto [@media(pointer:coarse)]:opacity-100",
					(persistent || menuOpen) && "pointer-events-auto opacity-100"
				)}
				data-slot="message-footer-primary-actions"
			>
				{persistent ? detailsButton : null}
				{persistent ? null : (
					<MessageFooterIconAction
						disabled={input.copyDisabled}
						icon={<CopyIcon aria-hidden="true" />}
						label="Copy message"
						onSelect={input.onCopy}
					/>
				)}
				{input.reply && !persistent ? (
					<MessageFooterIconAction
						disabled={input.reply.disabled}
						icon={<ArrowBendUpLeftIcon aria-hidden="true" />}
						label={input.reply.label}
						onSelect={input.reply.onSelect}
					/>
				) : null}
				{input.thread && !persistent ? (
					<MessageFooterIconAction
						disabled={input.thread.disabled}
						icon={<ChatCircleIcon aria-hidden="true" />}
						label={input.thread.label}
						onSelect={input.thread.onSelect}
					/>
				) : null}
				{input.addressingTargets.length > 0 && !persistent ? (
					<MessageAddressingPopover targets={input.addressingTargets} />
				) : null}
				{persistent ? null : detailsButton}
				{hasOverflowActions ? (
					<MessageFooterMoreMenu
						{...overflowActions}
						alwaysVisible={persistent}
						onOpenChange={setMenuOpen}
						open={menuOpen}
						pin={pin}
					/>
				) : null}
				<time className="ml-1 shrink-0 tabular-nums">{input.timestamp}</time>
			</div>
		</div>
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
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pin?: SpaceMessageFooterAction;
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	alwaysVisible?: boolean;
	onCopy?: () => void;
	reply?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
}) {
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
				<DropdownMenuGroup className="w-full [&>[data-slot=dropdown-menu-item]]:w-full">
					{input.pin ? (
						<FluidDropdownMenuItem
							disabled={input.pin.disabled}
							index={0}
							onClick={input.pin.onSelect}
						>
							<PushPinIcon aria-hidden="true" />
							{input.pin.label}
						</FluidDropdownMenuItem>
					) : null}
					{input.onCopy ? (
						<FluidDropdownMenuItem index={1} onClick={input.onCopy}>
							<CopyIcon aria-hidden="true" />
							Copy message
						</FluidDropdownMenuItem>
					) : null}
					{input.reply ? (
						<FluidDropdownMenuItem
							disabled={input.reply.disabled}
							index={2}
							onClick={input.reply.onSelect}
						>
							<ArrowBendUpLeftIcon aria-hidden="true" />
							{input.reply.label}
						</FluidDropdownMenuItem>
					) : null}
					{input.thread ? (
						<FluidDropdownMenuItem
							disabled={input.thread.disabled}
							index={3}
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
