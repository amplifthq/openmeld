import type { PatchSpaceMetaBody } from "@openmeld/schemas/types";
import { useState } from "react";

/**
 * `previous` is the guide text the edit started from, or the latest text
 * this editor successfully saved.
 */
export type SpaceGuideDraft = NonNullable<PatchSpaceMetaBody["guideEdit"]>;

/**
 * Keeps an open guide edit outside the panel, so switching Space tabs (which
 * unmounts the panel) does not throw the edit away. Leaving the Space with
 * unsaved text is guarded by the page's UnsavedChangesGuard.
 */
export function useSpaceGuideDraft(spaceId: string) {
	const [draft, setDraft] = useState<{
		spaceId: string;
		edit: SpaceGuideDraft;
	} | null>(null);
	const current = draft?.spaceId === spaceId ? draft.edit : null;
	return {
		draft: current,
		hasUnsavedChanges: current !== null && current.text !== current.previous,
		discard: () => setDraft(null),
		onDraftChange: (edit: SpaceGuideDraft | null) =>
			setDraft(edit === null ? null : { spaceId, edit }),
		/**
		 * Called when a save succeeds. Closes the editor, unless the text
		 * changed while the save was in flight; then the newer edit stays open.
		 */
		onSaved: (submitted: string, saved: string) =>
			setDraft((previous) => {
				if (previous?.spaceId !== spaceId) {
					return previous;
				}
				if (previous.edit.text === submitted) {
					return null;
				}
				return { spaceId, edit: { previous: saved, text: previous.edit.text } };
			}),
	};
}
