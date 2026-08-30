import { Popover } from "@base-ui/react/popover";
import type { MessageMentionType } from "@openmeld/schemas";
import { listSpaceMentionRelationChoices } from "@openmeld/space";
import { Bars } from "@openmeld/ui/components/bars";
import { cn } from "@openmeld/ui/lib/utils";
import { useEffect, useMemo, useRef } from "react";
import { resolveSpaceMemberStatusBadgeDisplay } from "#/lib/spaces/presentation";
import { SpaceMentionRelationSymbol } from "./space-composer-addressing";
import { SpaceMemberInlineStatusText } from "./space-member-inline-status-text";
import { resolveSpaceMemberInlineStatusTextClassName } from "./space-member-status-tone";
import { SpaceProfileIcon } from "./space-profile-icon";
import type {
	SpaceComposerSelection,
	SpaceMentionPickerItem,
	SpaceMentionPopoverState,
} from "./use-space-mention-authoring";
import { resolveDefaultSpaceComposerMentionRelation } from "./use-space-mention-authoring";

export function SpaceMentionPopover(input: {
	centerAgentProfileId?: string | null;
	composerSelection: SpaceComposerSelection;
	composerText: string;
	onHoverItem: (index: number) => void;
	onRequestClose: () => void;
	onSelectItem: (index: number, relation?: MessageMentionType) => void;
	state: SpaceMentionPopoverState;
	textareaRef: { current: HTMLTextAreaElement | null };
}) {
	const anchorRef = useRef<HTMLSpanElement | null>(null);
	const anchorPosition = useMemo(
		() =>
			resolveMentionAnchorPosition({
				caretIndex: input.composerSelection.start,
				text: input.composerText,
				textarea: input.textareaRef.current,
			}),
		[input.composerSelection.start, input.composerText, input.textareaRef]
	);

	useEffect(() => {
		const anchorElement = anchorRef.current;
		if (!anchorElement) {
			return;
		}

		anchorElement.style.cssText = [
			`left: ${String(anchorPosition.left)}px`,
			`top: ${String(anchorPosition.top)}px`,
		].join(";");
	}, [anchorPosition.left, anchorPosition.top]);

	// Keyboard owns the highlight until the pointer actually moves. A popover
	// opening under a stationary cursor — or its open/position animation shifting
	// rows beneath the cursor — fires mousemove events whose clientX/clientY never
	// change (the mouse didn't move; the element moved under it). Those phantom
	// events must NOT hand control to the mouse. Only a genuine move, detected as
	// a change in pointer coordinates, marks the pointer active. Re-arm each time
	// the popover opens.
	const pointerActiveRef = useRef(false);
	const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
	const isOpen = input.state.kind !== "closed";
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		pointerActiveRef.current = false;
		lastPointerPositionRef.current = null;
		const handlePointerMove = (event: MouseEvent) => {
			const previous = lastPointerPositionRef.current;
			lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
			if (
				previous &&
				(previous.x !== event.clientX || previous.y !== event.clientY)
			) {
				pointerActiveRef.current = true;
			}
		};
		window.addEventListener("mousemove", handlePointerMove);
		return () => {
			window.removeEventListener("mousemove", handlePointerMove);
		};
	}, [isOpen]);

	const handleHoverItem = (index: number) => {
		if (pointerActiveRef.current) {
			input.onHoverItem(index);
		}
	};

	return (
		<>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute z-10 h-px w-px opacity-0"
				ref={anchorRef}
			/>
			<Popover.Root
				modal={false}
				onOpenChange={(open) => {
					if (!open) {
						input.onRequestClose();
					}
				}}
				open={input.state.kind !== "closed"}
			>
				<Popover.Portal>
					<Popover.Positioner
						align="start"
						anchor={anchorRef}
						className="z-50"
						collisionAvoidance={{
							align: "shift",
							fallbackAxisSide: "start",
							side: "flip",
						}}
						collisionPadding={12}
						positionMethod="fixed"
						side="top"
						sideOffset={10}
					>
						<Popover.Popup
							className="z-50 flex max-h-[min(28rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none"
							data-testid="space-mention-popover"
							finalFocus={false}
							initialFocus={false}
						>
							<MentionPopoverBody {...input} onHoverItem={handleHoverItem} />
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</>
	);
}

function MentionPopoverBody(input: {
	centerAgentProfileId?: string | null;
	onHoverItem: (index: number) => void;
	onSelectItem: (index: number, relation?: MessageMentionType) => void;
	state: SpaceMentionPopoverState;
}) {
	if (input.state.kind === "closed") {
		return null;
	}

	if (input.state.kind === "loading" || input.state.kind === "unavailable") {
		return (
			<div className="flex flex-col gap-1 p-2">
				<p className="flex items-center gap-2 font-medium text-sm">
					{input.state.kind === "loading" ? (
						<Bars className="h-3 w-5 text-muted-foreground" />
					) : null}
					Members
				</p>
				<p className="text-muted-foreground text-xs leading-5">
					{input.state.message}
				</p>
			</div>
		);
	}

	if (input.state.kind === "empty") {
		return (
			<div className="flex flex-col gap-1 p-2">
				<p className="font-medium text-sm">No matches</p>
				<p className="text-muted-foreground text-xs leading-5">
					{input.state.message}
				</p>
			</div>
		);
	}

	const targetPickerState = input.state;
	const agentItems = targetPickerState.items.filter(
		(item) => item.suggestion.profileKind === "agent"
	);
	const humanItems = targetPickerState.items.filter(
		(item) => item.suggestion.profileKind === "human"
	);
	const highlightedItem =
		targetPickerState.items[targetPickerState.highlightedIndex] ?? null;

	return (
		<div className="flex min-h-0 flex-col gap-2">
			<div
				aria-label="Mention target options"
				className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-1"
				role="listbox"
			>
				{agentItems.length > 0 ? (
					<MentionSection
						centerAgentProfileId={input.centerAgentProfileId}
						highlightedIndex={targetPickerState.highlightedIndex}
						items={agentItems}
						offset={0}
						onHoverItem={input.onHoverItem}
						onSelectItem={input.onSelectItem}
						title="Agents"
					/>
				) : null}
				{humanItems.length > 0 ? (
					<MentionSection
						centerAgentProfileId={input.centerAgentProfileId}
						highlightedIndex={targetPickerState.highlightedIndex}
						items={humanItems}
						offset={agentItems.length}
						onHoverItem={input.onHoverItem}
						onSelectItem={input.onSelectItem}
						title="Humans"
					/>
				) : null}
			</div>
			{highlightedItem ? (
				<MentionRelationActions
					item={highlightedItem}
					onSelect={(relation) => {
						input.onSelectItem(targetPickerState.highlightedIndex, relation);
					}}
				/>
			) : null}
		</div>
	);
}

function MentionSection(input: {
	centerAgentProfileId?: string | null;
	highlightedIndex: number;
	items: readonly SpaceMentionPickerItem[];
	offset: number;
	onHoverItem: (index: number) => void;
	onSelectItem: (index: number) => void;
	title: string;
}) {
	return (
		<section className="flex flex-col gap-1">
			<p className="px-2 font-medium text-muted-foreground text-xs">
				{input.title}
			</p>
			<div className="flex flex-col gap-1">
				{input.items.map((item, index) => {
					const absoluteIndex = input.offset + index;
					return (
						<MentionOptionRow
							centerAgentProfileId={input.centerAgentProfileId}
							highlighted={input.highlightedIndex === absoluteIndex}
							item={item}
							key={buildItemKey(item)}
							onHover={() => {
								input.onHoverItem(absoluteIndex);
							}}
							onSelect={() => {
								input.onSelectItem(absoluteIndex);
							}}
						/>
					);
				})}
			</div>
		</section>
	);
}

function MentionOptionRow(input: {
	centerAgentProfileId?: string | null;
	highlighted: boolean;
	item: SpaceMentionPickerItem;
	onHover: () => void;
	onSelect: () => void;
}) {
	const commonClassName = cn(
		"w-full rounded-md border px-3 py-2 text-left transition-colors",
		input.highlighted
			? "border-border bg-muted"
			: "border-transparent bg-transparent"
	);

	const statusBadge = resolveSpaceMemberStatusBadgeDisplay(
		input.item.memberEntry
	);
	const availabilitySummary =
		statusBadge &&
		input.item.memberEntry.profileKind === "agent" &&
		statusBadge.availabilityPhase !== "available"
			? input.item.memberEntry.availabilitySummary
			: null;
	return (
		<button
			aria-selected={input.highlighted}
			className={commonClassName}
			onMouseDown={(event) => {
				event.preventDefault();
				input.onSelect();
			}}
			onMouseMove={input.onHover}
			role="option"
			type="button"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<SpaceProfileIcon
							agentControllerRef={input.item.memberEntry.agentControllerRef}
							className="mt-0.5"
							isCenterAgent={
								input.item.suggestion.profileKind === "agent" &&
								input.item.suggestion.profileId === input.centerAgentProfileId
							}
							profileId={input.item.suggestion.profileId}
							profileKind={input.item.suggestion.profileKind}
							profileName={input.item.suggestion.profileName}
						/>
						<p className="min-w-0 break-words font-bold text-sm">
							{input.item.suggestion.profileName}
						</p>
						{statusBadge ? (
							<SpaceMemberInlineStatusText
								availabilityAction={statusBadge.availabilityAction}
								availabilityPhase={statusBadge.availabilityPhase}
								availabilityReasonCode={statusBadge.availabilityReasonCode}
								className={resolveSpaceMemberInlineStatusTextClassName(
									input.item.memberEntry
								)}
								isRefreshing={statusBadge.isRefreshing}
								label={statusBadge.label}
								testId="space-mention-status-badge"
								tooltip={statusBadge.tooltip}
							/>
						) : null}
					</div>
					{availabilitySummary ? (
						<p
							className="truncate text-muted-foreground text-xs"
							data-testid="space-mention-availability-summary"
							title={availabilitySummary}
						>
							{availabilitySummary}
						</p>
					) : null}
				</div>
			</div>
		</button>
	);
}

function MentionRelationActions(input: {
	item: SpaceMentionPickerItem;
	onSelect: (relation: MessageMentionType) => void;
}) {
	if (input.item.suggestion.profileKind === "human") {
		return null;
	}
	const defaultRelation = resolveDefaultSpaceComposerMentionRelation(
		input.item.suggestion
	);
	const relationChoices = listSpaceMentionRelationChoices({
		allowedRelations: input.item.suggestion.allowedRelations,
		primaryMentionLabel: input.item.suggestion.primaryMentionLabel,
		wakeAvailability: input.item.suggestion.wakeAvailability,
	});

	return (
		<fieldset className="flex flex-wrap items-center gap-1.5 border-border border-t px-1 pt-2">
			<legend className="sr-only">
				How to include {input.item.suggestion.profileName}
			</legend>
			{relationChoices.map((choice) => (
				<button
					aria-label={`${choice.label} ${input.item.suggestion.profileName}`}
					className={cn(
						"inline-flex h-7 items-center gap-1 rounded-sm border px-2 font-medium text-xs transition-colors",
						choice.relation === defaultRelation
							? "border-foreground/20 bg-foreground/10 text-foreground"
							: "border-border bg-background text-muted-foreground"
					)}
					key={choice.relation}
					onClick={() => {
						input.onSelect(choice.relation);
					}}
					onMouseDown={(event) => {
						event.preventDefault();
					}}
					title={choice.description}
					type="button"
				>
					<SpaceMentionRelationSymbol relation={choice.relation} />
					<span>{choice.label}</span>
				</button>
			))}
		</fieldset>
	);
}

function buildItemKey(item: SpaceMentionPickerItem) {
	return item.suggestion.profileId;
}

function resolveMentionAnchorPosition(input: {
	caretIndex: number;
	text: string;
	textarea: HTMLTextAreaElement | null;
}) {
	const fallback = {
		left: 16,
		top: 16,
	};
	if (!input.textarea) {
		return fallback;
	}

	const textarea = input.textarea;
	const mirror = document.createElement("div");
	const marker = document.createElement("span");
	const computedStyle = window.getComputedStyle(textarea);
	const textareaRect = textarea.getBoundingClientRect();

	mirror.style.cssText = [
		...MIRROR_STYLE_PROPERTIES.map(
			(propertyName) =>
				`${propertyName}: ${computedStyle.getPropertyValue(propertyName)}`
		),
		"left: 0",
		"overflow: hidden",
		"pointer-events: none",
		"position: absolute",
		"top: 0",
		"visibility: hidden",
		"white-space: pre-wrap",
		`width: ${String(textareaRect.width || textarea.clientWidth || 320)}px`,
		"word-break: break-word",
	].join(";");
	mirror.textContent = input.text.slice(0, input.caretIndex);

	marker.textContent = "\u200b";
	mirror.appendChild(marker);
	document.body.appendChild(mirror);

	const markerRect = marker.getBoundingClientRect();
	const mirrorRect = mirror.getBoundingClientRect();
	const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
	document.body.removeChild(mirror);

	return {
		left:
			textarea.offsetLeft +
			(markerRect.left - mirrorRect.left) -
			textarea.scrollLeft +
			resolveHorizontalPadding(computedStyle),
		top:
			textarea.offsetTop +
			(markerRect.top - mirrorRect.top) -
			textarea.scrollTop +
			resolveVerticalPadding(computedStyle) +
			lineHeight,
	};
}

function resolveHorizontalPadding(style: CSSStyleDeclaration) {
	return Number.parseFloat(style.paddingLeft) || 0;
}

function resolveVerticalPadding(style: CSSStyleDeclaration) {
	return Number.parseFloat(style.paddingTop) || 0;
}

const MIRROR_STYLE_PROPERTIES = [
	"border-bottom-width",
	"border-left-width",
	"border-right-width",
	"border-top-width",
	"box-sizing",
	"font-family",
	"font-feature-settings",
	"font-kerning",
	"font-optical-sizing",
	"font-size",
	"font-stretch",
	"font-style",
	"font-variant",
	"font-weight",
	"letter-spacing",
	"line-height",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
	"tab-size",
	"text-indent",
	"text-rendering",
	"text-transform",
	"white-space",
	"word-spacing",
] as const;
