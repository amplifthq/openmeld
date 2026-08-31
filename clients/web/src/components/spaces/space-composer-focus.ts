import type { PlateEditor } from "platejs/react";

export function isEditorReadyToFocus(
	editor: Pick<PlateEditor, "api" | "operations" | "selection">
): boolean {
	if (editor.operations.length > 0) {
		return false;
	}
	if (!editor.selection) {
		return true;
	}
	try {
		return Boolean(editor.api.toDOMRange(editor.selection));
	} catch {
		return false;
	}
}
