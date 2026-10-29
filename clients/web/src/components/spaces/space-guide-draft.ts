import { useEffect, useState } from "react";

/** An unsaved guide edit, scoped to the Space it was written in. */
export type SpaceGuideDraft = { spaceId: string; text: string };

/**
 * Keeps an unsaved guide edit outside the panel, so switching Space tabs
 * (which unmounts the panel) does not throw the edit away.
 */
export function useSpaceGuideDraft(spaceId: string) {
	const [draft, setDraft] = useState<SpaceGuideDraft | null>(null);
	const text = draft?.spaceId === spaceId ? draft.text : null;
	const editing = text !== null;
	useEffect(() => {
		if (!editing) {
			return;
		}
		const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warnBeforeLeaving);
		return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
	}, [editing]);
	return {
		draft: text,
		onDraftChange: (next: string | null) =>
			setDraft(next === null ? null : { spaceId, text: next }),
	};
}
