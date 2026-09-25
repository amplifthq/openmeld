import { buildSpaceFileContentPath } from "@openmeld/api-client";
import { WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM } from "./web-space-attachment-path";

/** Same-origin, revision-pinned media. Session and protected-Space secrets stay in cookies. */
export function buildWebSpaceVideoPath(input: {
	spaceId: string;
	fileId: string;
	revision: number;
	organizationSlug?: string;
}): string {
	const path = buildSpaceFileContentPath(input.spaceId, input.fileId, {
		revision: input.revision,
	});
	if (!input.organizationSlug) {
		return path;
	}
	const query = new URLSearchParams({
		[WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM]:
			input.organizationSlug,
	});
	return `${path}&${query}`;
}
