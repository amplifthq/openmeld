"use client";

export async function copyTextToClipboard(value: string): Promise<boolean> {
	if (typeof navigator !== "undefined" && navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(value);
			return true;
		} catch {
			// Fall through to the user-gesture textarea fallback below.
		}
	}

	return copyTextWithTextareaFallback(value);
}

function copyTextWithTextareaFallback(value: string): boolean {
	if (typeof document === "undefined") {
		return false;
	}

	const copyCommand = document.execCommand;
	if (typeof copyCommand !== "function") {
		return false;
	}

	const activeElement =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	const textArea = document.createElement("textarea");
	textArea.value = value;
	textArea.setAttribute("readonly", "");
	textArea.style.cssText = [
		"height: 1px",
		"left: 0",
		"opacity: 0",
		"pointer-events: none",
		"position: fixed",
		"top: 0",
		"width: 1px",
	].join(";");

	document.body.appendChild(textArea);
	textArea.focus();
	textArea.select();
	textArea.setSelectionRange(0, value.length);

	try {
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		textArea.remove();
		activeElement?.focus();
	}
}
