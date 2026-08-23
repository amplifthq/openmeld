import type { InboxItem } from "@openmeld/schemas/types";
import {
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentTaskPath,
	buildOrganizationChannelsPath,
	buildOrganizationComputersPath,
	buildOrganizationDocumentPath,
	buildOrganizationNotificationsSettingsPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";

export function buildInboxItemSourceNavigation(input: {
	item: InboxItem;
	orgSlug: string;
}): { href: string; openInNewTab: boolean } {
	const target = input.item.sourceTarget;
	switch (target.kind) {
		case "agent_profile_creation_request":
			return {
				href: buildOrganizationAgentCreationRequestsPath({
					orgSlug: input.orgSlug,
					requestId: target.requestId,
				}),
				openInNewTab: false,
			};
		case "space":
			return {
				href: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					search: {
						focusSignalId: target.signalId,
						focusThreadRootSignalId: target.threadRootSignalId,
					},
					spaceId: target.spaceId,
				}),
				openInNewTab: false,
			};
		case "agent_interaction":
			return {
				href: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					search: {
						focusInteractionId: target.interactionId,
						focusSignalId: target.sourceSignalId,
					},
					spaceId: target.spaceId,
				}),
				openInNewTab: false,
			};
		case "organization_document":
			return {
				href: buildOrganizationDocumentPath({
					documentId: target.documentId,
					orgSlug: input.orgSlug,
				}),
				openInNewTab: false,
			};
		case "center_agent":
			return {
				href: buildOrganizationCenterAgentChatPath(input.orgSlug, {
					focusSignalId: target.signalId,
				}),
				openInNewTab: false,
			};
		case "center_agent_task":
			return {
				href: buildOrganizationCenterAgentTaskPath({
					orgSlug: input.orgSlug,
					taskId: target.taskId,
				}),
				openInNewTab: false,
			};
		case "message_channel":
			return { href: target.permalink, openInNewTab: true };
		case "settings":
			return {
				href: resolveSettingsTargetPath({
					orgSlug: input.orgSlug,
					section: target.section,
				}),
				openInNewTab: false,
			};
		default:
			return assertNever(target);
	}
}

function resolveSettingsTargetPath(input: {
	orgSlug: string;
	section: "channels" | "computers" | "notifications";
}): string {
	switch (input.section) {
		case "channels":
			return buildOrganizationChannelsPath(input.orgSlug);
		case "computers":
			return buildOrganizationComputersPath(input.orgSlug);
		case "notifications":
			return buildOrganizationNotificationsSettingsPath(input.orgSlug);
		default:
			return assertNever(input.section);
	}
}

/**
 * Whether the given app pathname is the canonical source location of the item,
 * ignoring query params: a member standing inside that conversation is already
 * seeing its updates, so a system notification would only repeat the screen.
 * External targets (for example message_channel permalinks) never match.
 */
export function isInboxItemSourceLocation(input: {
	item: InboxItem;
	orgSlug: string;
	pathname: string | null;
}): boolean {
	if (!input.pathname) {
		return false;
	}
	let sourceHref: string;
	try {
		sourceHref = buildInboxItemSourceNavigation({
			item: input.item,
			orgSlug: input.orgSlug,
		}).href;
	} catch {
		return false;
	}
	const sourcePathname = sourceHref.split("?", 1)[0] ?? sourceHref;
	return (
		normalizeSourcePathname(sourcePathname) ===
		normalizeSourcePathname(input.pathname)
	);
}

const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeSourcePathname(pathname: string): string {
	let normalized = pathname;
	try {
		normalized = decodeURI(normalized);
	} catch {
		// Compare the raw value when the path is not valid percent-encoded text.
	}
	return normalized.length > 1
		? normalized.replace(TRAILING_SLASHES_PATTERN, "")
		: normalized;
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Inbox source target: ${JSON.stringify(value)}`);
}
