import { useState } from "react";

/**
 * An open guide edit, scoped to the Space it was written in. `saved` is the
 * guide text the edit started from, or the text most recently saved from it.
 */
export type SpaceGuideDraft = { spaceId: string; text: string; saved: string };

/**
 * Keeps an open guide edit outside the panel, so switching Space tabs (which
 * unmounts the panel) does not throw the edit away. Leaving the Space with
 * unsaved text is guarded by the page's UnsavedChangesGuard.
 */
export function useSpaceGuideDraft(spaceId: string) {
	const [draft, setDraft] = useState<SpaceGuideDraft | null>(null);
	const current = draft?.spaceId === spaceId ? draft : null;
	return {
		draft: current?.text ?? null,
		hasUnsavedChanges: current !== null && current.text !== current.saved,
		discard: () => setDraft(null),
		onDraftChange: (next: string | null) =>
			setDraft((previous) => {
				if (next === null) {
					return null;
				}
				// Starting an edit: the opening text is what is already saved.
				const saved = previous?.spaceId === spaceId ? previous.saved : next;
				return { spaceId, text: next, saved };
			}),
		/**
		 * Called when a save succeeds. Closes the editor, unless the text
		 * changed while the save was in flight; then the newer edit stays open.
		 */
		onSaved: (submitted: string) =>
			setDraft((previous) => {
				if (previous?.spaceId !== spaceId || previous.text === submitted) {
					return null;
				}
				return { ...previous, saved: submitted };
			}),
	};
}
