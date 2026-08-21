export const SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM = "organization_slug";

export function buildSlackOAuthStartPath(input: {
	moveFromOrganizationId?: string;
	organizationSlug: string;
}): string {
	const organizationSlug = input.organizationSlug.trim();
	if (!organizationSlug) {
		throw new Error("Slack OAuth requires an organization slug.");
	}

	const searchParams = new URLSearchParams({
		[SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM]: organizationSlug,
	});
	const moveFromOrganizationId = input.moveFromOrganizationId?.trim();
	if (moveFromOrganizationId) {
		searchParams.set("move_from", moveFromOrganizationId);
	}

	return `/slack/oauth/start?${searchParams.toString()}`;
}

export function buildSlackIdentityStartPath(organizationSlug: string): string {
	const normalizedSlug = organizationSlug.trim();
	if (!normalizedSlug) {
		throw new Error(
			"Slack identity authorization requires an organization slug."
		);
	}
	return `/slack/identity/start?${new URLSearchParams({
		[SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM]: normalizedSlug,
	}).toString()}`;
}
