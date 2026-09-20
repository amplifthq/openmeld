import DOMPurify from "dompurify";

// Preview limits are independent of the upload and source-editing limits.
export const SPACE_FILE_HTML_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const SPACE_FILE_HTML_PREVIEW_NOTICE =
	"Static preview. Scripts, external resources, and links are disabled.";

const RESOURCE_POLICY =
	"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

export function isSpaceFileHtml(mimeType: string): boolean {
	return mimeType === "text/html";
}

/** Browser-only. Never insert uploaded markup into the application's document. */
export function buildSpaceFileHtmlDocument(source: string): string {
	const root = DOMPurify.sanitize(source, {
		WHOLE_DOCUMENT: true,
		RETURN_DOM: true,
		USE_PROFILES: { html: true, svg: true, svgFilters: true },
		FORBID_TAGS: [
			"base",
			"link",
			"meta",
			"script",
			"iframe",
			"frame",
			"frameset",
			"object",
			"embed",
			"form",
			"input",
			"button",
			"textarea",
			"select",
			"option",
			"audio",
			"video",
			"source",
			"track",
			"animate",
			"animateMotion",
			"animateTransform",
			"set",
			"foreignObject",
		],
		FORBID_ATTR: [
			"href",
			"xlink:href",
			"srcset",
			"action",
			"formaction",
			"ping",
			"autofocus",
			"contenteditable",
			"popover",
		],
	});
	if (!(root instanceof HTMLElement)) {
		throw new Error("HTML preview could not be prepared.");
	}
	const head = root.querySelector("head");
	if (!head) {
		throw new Error("HTML preview could not be prepared.");
	}
	const policy = document.createElement("meta");
	policy.httpEquiv = "Content-Security-Policy";
	policy.content = `${RESOURCE_POLICY}; frame-src 'none'`;
	head.insertBefore(policy, head.firstChild);
	return `<!doctype html>${root.outerHTML}`;
}

export function buildSpaceFileHtmlPreviewPath(input: {
	spaceId: string;
	fileId: string;
	revision: number;
	profileId?: string;
	organizationSlug?: string;
}): string {
	const search = new URLSearchParams({
		spaceId: input.spaceId,
		fileId: input.fileId,
		revision: String(input.revision),
	});
	if (input.profileId) {
		search.set("profileId", input.profileId);
	}
	if (input.organizationSlug) {
		search.set("organizationSlug", input.organizationSlug);
	}
	return `/file-preview?${search}`;
}
