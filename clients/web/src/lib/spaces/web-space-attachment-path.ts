import { buildSpaceAttachmentDownloadPath } from "@openmeld/api-client";

export const WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM =
	"__openmeld_organization_slug";

export function buildWebSpaceAttachmentDownloadPath(input: {
	attachmentId: string;
	organizationSlug?: string;
	spaceId: string;
}): string {
	const path = buildSpaceAttachmentDownloadPath(
		input.spaceId,
		input.attachmentId
	);
	const organizationSlug = input.organizationSlug?.trim();
	if (!organizationSlug) {
		return path;
	}

	const search = new URLSearchParams({
		[WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM]: organizationSlug,
	});
	return `${path}?${search.toString()}`;
}
