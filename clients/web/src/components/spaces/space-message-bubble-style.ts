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
		return "px-3 pt-1.5 pb-1.5";
	}
	if (input.isFirstInGroup) {
		return "px-3 pt-1.5 pb-0";
	}
	if (input.isLastInGroup) {
		return "px-3 pt-1 pb-1.5";
	}
	return "px-3 pt-1 pb-0";
}
// Hover/focus-within background for one message row. Apply this to the
// per-message row element, not to a container that spans multiple grouped
// messages, so hovering one message never highlights its neighbors.
export const SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS =
	"rounded-md transition-colors hover:bg-muted/35 focus-within:bg-muted/35";
export function resolveSpaceMessageBubblePresentationClass(input: {
	isHighlighted?: boolean;
	isSelf?: boolean;
}): string {
	if (input.isHighlighted) {
		return "rounded-md border border-transparent bg-muted/50";
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
