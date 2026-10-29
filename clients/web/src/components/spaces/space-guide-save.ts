import { MAX_SPACE_GUIDE_LENGTH } from "@openmeld/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { spaceQueryKeys } from "#/query/spaces/status";

/** True when a guide draft is over the server cap and cannot be saved. */
export function isSpaceGuideTooLong(text: string) {
	return text.trim().length > MAX_SPACE_GUIDE_LENGTH;
}

/**
 * "Save and leave" for an unsaved guide edit. Resolves true when it is safe
 * to leave, false when the draft cannot be saved (the dialog shows an error).
 */
export async function saveSpaceGuideBeforeLeaving(
	draft: string | null,
	save: (guide: string) => Promise<unknown>
): Promise<boolean> {
	if (draft === null) {
		return true;
	}
	if (isSpaceGuideTooLong(draft)) {
		return false;
	}
	try {
		await save(draft);
		return true;
	} catch {
		return false;
	}
}

/**
 * Saves a Space guide. Shared by the editor's Save button and the
 * "Save and leave" choice when leaving the Space with unsaved edits.
 */
export function useSaveSpaceGuide(input: {
	openMeldProfileId: string;
	spaceId: string;
	/** Called with the submitted text when the save succeeds. */
	onSaved: (submitted: string) => void;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (guide: string) =>
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			}).updateMeta({ spaceId: input.spaceId, guide }),
		onSuccess: (meta, submitted) => {
			queryClient.setQueryData(
				spaceQueryKeys.meta(input.spaceId, input.openMeldProfileId),
				meta
			);
			// Keeps the editor open if the text changed while saving.
			input.onSaved(submitted);
			toast.success("Guide saved.");
		},
	});
}
