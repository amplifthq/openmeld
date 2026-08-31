import type { PlateEditor } from "platejs/react";

export const SPACE_COMPOSER_FOCUS_RETRY_FRAMES = 2;

export type SpaceComposerFocusReadiness = "cancel" | "focus" | "retry";

export function getEditorFocusReadiness(
	editor: Pick<PlateEditor, "api" | "operations" | "selection">,
	retryFramesRemaining: number
): SpaceComposerFocusReadiness {
	if (editor.operations.length > 0) {
		return retryFramesRemaining > 0 ? "retry" : "cancel";
	}
	if (!editor.selection) {
		return "focus";
	}
	try {
		if (editor.api.toDOMRange(editor.selection)) {
			return "focus";
		}
		return retryFramesRemaining > 0 ? "retry" : "cancel";
	} catch {
		return retryFramesRemaining > 0 ? "retry" : "cancel";
	}
}
