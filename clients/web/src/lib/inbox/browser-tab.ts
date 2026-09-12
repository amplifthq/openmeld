// Route head management continues to own the page title. Decorate it without
// copying route naming rules, and restore it on logout or workspace changes.
export function applyInboxTabTitle(label: string | null): () => void {
	if (!label) {
		return () => undefined;
	}
	const prefix = `${label} · `;
	const update = () => {
		if (!document.title.startsWith(prefix)) {
			document.title = `${prefix}${document.title}`;
		}
	};
	update();
	const observer = new MutationObserver(update);
	observer.observe(document.head, {
		childList: true,
		characterData: true,
		subtree: true,
	});
	return () => {
		observer.disconnect();
		if (document.title.startsWith(prefix)) {
			document.title = document.title.slice(prefix.length);
		}
	};
}

export async function renderInboxTabIcon(
	source: string,
	color: string
): Promise<string> {
	const logo = new Image();
	logo.src = source;
	await logo.decode();
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 32;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Canvas is unavailable for the Inbox tab icon");
	}
	context.drawImage(logo, 0, 0, 32, 32);
	// A contrasting outline keeps the six-pixel dot legible in light and dark tabs.
	context.beginPath();
	context.arc(25, 7, 6, 0, Math.PI * 2);
	context.fillStyle = color;
	context.fill();
	context.strokeStyle = "white";
	context.lineWidth = 2;
	context.stroke();
	return canvas.toDataURL("image/png");
}
