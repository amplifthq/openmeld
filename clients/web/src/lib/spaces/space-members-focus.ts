import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod/v4";

// A link that opens a Space's Members panel at one section, optionally
// naming a row to scroll to and highlight:
// `?panel=members&section=agent-access&highlight=<entryId>`.

export const SPACE_AGENT_ACCESS_SECTION = "agent-access";

export const spaceMembersFocusSearchShape = {
	panel: z.literal("members").optional(),
	section: z.literal(SPACE_AGENT_ACCESS_SECTION).optional(),
	highlight: z.string().trim().min(1).max(512).optional(),
};

const spaceMembersFocusSearchSchema = z.object(spaceMembersFocusSearchShape);

export type SpaceMembersFocusSearch = z.infer<
	typeof spaceMembersFocusSearchSchema
>;

/** The search for a link to a Space's Agent access section. */
export function buildSpaceAgentAccessSearch(
	highlight?: string | null
): Record<string, string> {
	return {
		panel: "members",
		section: SPACE_AGENT_ACCESS_SECTION,
		...(highlight ? { highlight } : {}),
	};
}

export function pickSpaceMembersFocusSearch(
	search: SpaceMembersFocusSearch
): SpaceMembersFocusSearch {
	return {
		panel: search.panel,
		section: search.section,
		highlight: search.highlight,
	};
}

/** The current URL's Members focus; empty when the link names none. */
export function useSpaceMembersFocus(): SpaceMembersFocusSearch {
	const search = useLocation({ select: (location) => location.search });
	const parsed = spaceMembersFocusSearchSchema.safeParse(search ?? {});
	return parsed.success ? parsed.data : {};
}

/** The Agent access row a link names, if the link opens that section. */
export function resolveAgentAccessHighlightId(
	focus: SpaceMembersFocusSearch
): string | null {
	return focus.section === SPACE_AGENT_ACCESS_SECTION
		? (focus.highlight ?? null)
		: null;
}

/** Opens the Members panel once for each link that asks for it. */
export function useOpenMembersPanelForFocus(input: {
	focus: SpaceMembersFocusSearch;
	spaceId: string;
	onOpen: (open: boolean) => void;
}): void {
	const { highlight, panel } = input.focus;
	const handledRef = useRef<string | null>(null);
	const { onOpen, spaceId } = input;
	useEffect(() => {
		if (panel !== "members") {
			return;
		}
		const key = `${spaceId}:${highlight ?? ""}`;
		if (handledRef.current === key) {
			return;
		}
		handledRef.current = key;
		onOpen(true);
	}, [highlight, onOpen, panel, spaceId]);
}
