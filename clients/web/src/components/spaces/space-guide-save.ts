import { MAX_SPACE_GUIDE_LENGTH } from "@openmeld/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { spaceQueryKeys } from "#/query/spaces/status";

/** True when a guide draft is over the server cap and cannot be saved. */
export function isSpaceGuideTooLong(text: string) {
	return text.trim().length > MAX_SPACE_GUIDE_LENGTH;
}

/**
 * One save path for a Space's guide, shared by the editor's Save button and
 * "Save and leave". It remembers the request in flight so a later save can
 * wait for it; otherwise an older write could land after a newer one.
 */
export type SpaceGuideSaver = {
	error: Error | null;
	isPending: boolean;
	reset: () => void;
	/** Starts a save. Rejects when the save fails. */
	save: (guide: string) => Promise<unknown>;
	/** Resolves once every save started so far has finished. */
	settle: () => Promise<void>;
};

/**
 * "Save and leave" for an unsaved guide edit. Waits for any save already in
 * flight, then saves the current draft. Resolves true when it is safe to
 * leave, false when the draft cannot be saved (the dialog shows an error).
 */
export async function saveSpaceGuideBeforeLeaving(
	draft: string | null,
	saver: Pick<SpaceGuideSaver, "save" | "settle">
): Promise<boolean> {
	await saver.settle();
	if (draft === null) {
		return true;
	}
	if (isSpaceGuideTooLong(draft)) {
		return false;
	}
	try {
		await saver.save(draft);
		return true;
	} catch {
		return false;
	}
}

/** Create once per Space page and pass the result to every save entry point. */
export function useSpaceGuideSaver(input: {
	openMeldProfileId: string;
	spaceId: string;
	/** Called with the submitted text when the save succeeds. */
	onSaved: (submitted: string) => void;
}): SpaceGuideSaver {
	const queryClient = useQueryClient();
	const mutation = useMutation({
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
	const { mutateAsync } = mutation;
	const inFlight = useRef<Promise<unknown> | null>(null);
	const save = useCallback(
		(guide: string) => {
			const tracked: Promise<unknown> = mutateAsync(guide).finally(() => {
				if (inFlight.current === tracked) {
					inFlight.current = null;
				}
			});
			inFlight.current = tracked;
			return tracked;
		},
		[mutateAsync]
	);
	const settle = useCallback(async () => {
		while (inFlight.current) {
			await inFlight.current.catch(() => undefined);
		}
	}, []);
	return {
		error: mutation.error,
		isPending: mutation.isPending,
		reset: mutation.reset,
		save,
		settle,
	};
}
