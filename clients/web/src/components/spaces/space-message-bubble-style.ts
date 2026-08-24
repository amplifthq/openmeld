export const SPACE_MESSAGE_SURFACE_WIDTH_CLASS = "w-full max-w-full";
// Other members and Agents keep transparent transcript surfaces. The current
// member gets a readable filled surface with its own inset.
export const SPACE_MESSAGE_CONTENT_PADDING_CLASS = "px-0 py-0 sm:px-0";
export const SPACE_SELF_MESSAGE_CONTENT_PADDING_CLASS = "px-3 py-2 sm:px-4";
// Padding shared by every message row/run container. Layout-only: it carries
// no hover coloring so callers can apply SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS
// at whatever granularity (single message vs. a grouped run) fits the case.
export const SPACE_MESSAGE_ROW_LAYOUT_CLASS = "px-3 py-2";
export function resolveSpaceMessageRowLayoutClassName(input: {
	isFirstInGroup: boolean;
	isLastInGroup: boolean;
}): string {
	if (input.isFirstInGroup && input.isLastInGroup) {
		return SPACE_MESSAGE_ROW_LAYOUT_CLASS;
	}
	if (input.isFirstInGroup) {
		return "px-3 pt-2 pb-0";
	}
	if (input.isLastInGroup) {
		return "px-3 pt-0 pb-2";
	}
	return "px-3 py-0";
}
// Hover/focus-within background for one message row. Apply this to the
// per-message row element, not to a container that spans multiple grouped
// messages, so hovering one message never highlights its neighbors.
export const SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS =
	"rounded-md transition-colors hover:bg-muted/35 focus-within:bg-muted/35";
// MessageScrollerItem carries content-visibility:auto for scroll perf, which
// forces paint containment and clips MessageHoverActions' `-top-6` escape
// for every grouped row after a run's first message (only the first has a
// header tall enough to absorb it). Reserve the height inside the item's
// own box instead of above it, and cancel the shift with an equal negative
// margin so the row's visual position doesn't move. That reserved padding
// now geometrically overlaps the previous row, so the item becomes a
// click-through shell (pointer-events-none); pair with pointer-events-auto
// on Message to keep the row's own content interactive.
export const SPACE_MESSAGE_ROW_HOVER_SAFE_ZONE_CLASS =
	"pointer-events-none pt-8 -mt-8";

export function resolveSpaceMessageBubblePresentationClass(input: {
	isHighlighted?: boolean;
	isSelf?: boolean;
}): string {
	if (input.isHighlighted) {
		return "rounded-md border border-ring/40 bg-ring/10 ring-1 ring-ring/50";
	}
	if (input.isSelf) {
		return "rounded-md border border-transparent bg-muted/35";
	}

	return "border border-transparent bg-transparent";
}

export function resolveSpaceMessageContentPaddingClassName(input: {
	isSelf: boolean;
}): string {
	return input.isSelf
		? SPACE_SELF_MESSAGE_CONTENT_PADDING_CLASS
		: SPACE_MESSAGE_CONTENT_PADDING_CLASS;
}

export function resolveSpaceMessageContentLayoutClassName(input: {
	isSelf: boolean;
}): string | undefined {
	return input.isSelf ? "items-start text-start" : undefined;
}

export function resolveSpaceMessageActionButtonClassName(input: {
	isHighlighted?: boolean;
}): string {
	if (input.isHighlighted) {
		return "border-0 border-transparent bg-ring/10 shadow-none hover:bg-ring/10 focus-visible:border-0 dark:bg-ring/10 dark:hover:bg-ring/10";
	}

	return "border-0 border-transparent bg-background/95 shadow-none hover:bg-muted focus-visible:border-0 dark:bg-background/95 dark:hover:bg-muted";
}
