import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
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
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowBendUpLeftIcon,
	ChatCircleIcon,
	CopyIcon,
	DotsThreeIcon,
	TargetIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceDeviceWaitOutcome } from "./space-device-wait-outcome";
import {
	MessageActionTooltip,
	MessageDetailsActionButton,
} from "./space-message-actions";
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

export function SpaceMessageFooter(input: {
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
}) {
	const persistent = Boolean(input.failureSummary);
	const hasOverflowActions =
		persistent ||
		Boolean(input.reply || input.thread || input.addressingTargets.length > 0);
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
					persistent && "pointer-events-auto opacity-100"
				)}
				data-slot="message-footer-primary-actions"
			>
				{input.deviceWaitOutcome ? (
					<SpaceDeviceWaitOutcome {...input.deviceWaitOutcome} />
				) : null}
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
						className="@max-[36rem]:hidden"
						disabled={input.reply.disabled}
						icon={<ArrowBendUpLeftIcon aria-hidden="true" />}
						label={input.reply.label}
						onSelect={input.reply.onSelect}
					/>
				) : null}
				{input.thread && !persistent ? (
					<MessageFooterIconAction
						className="@max-[36rem]:hidden"
						disabled={input.thread.disabled}
						icon={<ChatCircleIcon aria-hidden="true" />}
						label={input.thread.label}
						onSelect={input.thread.onSelect}
					/>
				) : null}
				{input.addressingTargets.length > 0 && !persistent ? (
					<MessageAddressingPopover
						className="@max-[36rem]:hidden"
						targets={input.addressingTargets}
					/>
				) : null}
				{persistent ? null : detailsButton}
				{hasOverflowActions ? (
					<MessageFooterMoreMenu
						addressingTargets={input.addressingTargets}
						alwaysVisible={persistent}
						onCopy={
							persistent && !input.copyDisabled ? input.onCopy : undefined
						}
						reply={input.reply}
						thread={input.thread}
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
	addressingTargets: readonly SpaceMessageFooterAddressingTarget[];
	alwaysVisible?: boolean;
	onCopy?: () => void;
	reply?: SpaceMessageFooterAction;
	thread?: SpaceMessageFooterAction;
}) {
	return (
		<DropdownMenu>
			<MessageActionTooltip label="More actions">
				<DropdownMenuTrigger
					aria-label="More actions"
					className={cn(
						FOOTER_BUTTON_CLASS_NAME,
						input.alwaysVisible ? null : "@min-[36rem]:hidden"
					)}
					render={<Button size="icon-sm" type="button" variant="ghost" />}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
			</MessageActionTooltip>
			<DropdownMenuContent align="start" className="w-52" sideOffset={6}>
				<DropdownMenuGroup>
					{input.onCopy ? (
						<DropdownMenuItem onClick={input.onCopy}>
							<CopyIcon aria-hidden="true" />
							Copy message
						</DropdownMenuItem>
					) : null}
					{input.reply ? (
						<DropdownMenuItem
							disabled={input.reply.disabled}
							onClick={input.reply.onSelect}
						>
							<ArrowBendUpLeftIcon aria-hidden="true" />
							{input.reply.label}
						</DropdownMenuItem>
					) : null}
					{input.thread ? (
						<DropdownMenuItem
							disabled={input.thread.disabled}
							onClick={input.thread.onSelect}
						>
							<ChatCircleIcon aria-hidden="true" />
							{input.thread.label}
						</DropdownMenuItem>
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
			</DropdownMenuContent>
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
