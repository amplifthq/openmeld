import { isInboxItemVisibleConversation } from "@openmeld/api-client";
import type { InboxVisibleConversation } from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";

export type { InboxVisibleConversation } from "@openmeld/schemas";

import {
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationCenterAgentChatPath,
	buildOrganizationChannelsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationDocumentPath,
	buildOrganizationInboxPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { buildAgentProfilePath } from "#/lib/profile-routes";

export function buildInboxItemSourceNavigation(input: {
	item: Pick<InboxItem, "sourceTarget"> & Partial<Pick<InboxItem, "id">>;
	orgSlug: string;
}): { href: string; openInNewTab: boolean } {
	const target = input.item.sourceTarget;
	switch (target.kind) {
		case "computer_connection":
			return {
				href: `${buildOrganizationComputerPath({ deviceId: target.deviceId, orgSlug: input.orgSlug })}?focus=service`,
				openInNewTab: false,
			};
		case "desktop_update":
		case "plugin_action_request":
		case "agent_access_request":
		case "credential_confirmation":
			if (!input.item.id) {
				throw new Error(
					"Inbox detail navigation requires its canonical Inbox item."
				);
			}
			return {
				href: `${buildOrganizationInboxPath(input.orgSlug)}?item=${encodeURIComponent(input.item.id)}`,
				openInNewTab: false,
			};
		case "organization_join_request":
			return {
				href: `/o/${encodeURIComponent(input.orgSlug)}/inbox?requestId=${encodeURIComponent(target.requestId)}`,
				openInNewTab: false,
			};
		case "agent_profile":
			return {
				href: buildAgentProfilePath({
					orgSlug: input.orgSlug,
					profileId: target.profileId,
				}),
				openInNewTab: false,
			};
		case "agent_profile_creation_request":
			return {
				href: buildOrganizationAgentCreationRequestsPath({
					orgSlug: input.orgSlug,
					requestId: target.requestId,
				}),
				openInNewTab: false,
			};
		case "space":
			if (target.directMessage) {
				return {
					href: buildOrganizationDirectMessagePath({
						orgSlug: input.orgSlug,
						spaceId: target.spaceId,
						search: {
							focusSignalId: target.signalId,
							focusThreadRootSignalId: target.threadRootSignalId,
						},
					}),
					openInNewTab: false,
				};
			}
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
			// The owner answers in Inbox detail, which also opens the conversation.
			return {
				href: input.item.id
					? `${buildOrganizationInboxPath(input.orgSlug)}?item=${encodeURIComponent(input.item.id)}`
					: buildInboxAgentInteractionConversationHref({
							orgSlug: input.orgSlug,
							target,
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
					session: target.spaceId,
					focusSignalId: target.signalId,
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
			return `${buildOrganizationInboxPath(input.orgSlug)}?appSettings=notifications`;
		default:
			return assertNever(input.section);
	}
}

/**
 * Whether the current app surface is the exact source conversation for the
 * item. Space pages need the rendered view and active thread because Messages,
 * Files, Graph, the main timeline, and every thread share one pathname.
 * External targets (for example message_channel permalinks) never match.
 */
/**
 * Opening an Inbox detail from the Inbox keeps the user's filter: the
 * current view and filters stay, and only the selected item changes.
 */
export function keepInboxFilters(input: {
	currentPathname: string;
	currentSearch: string;
	href: string;
}): string {
	const [pathname = "", search = ""] = input.href.split("?", 2);
	const target = normalizeSourcePathname(pathname);
	// Only Inbox detail: a Space's focus parameters must never carry over.
	if (
		!INBOX_PATHNAME_PATTERN.test(target) ||
		target !== normalizeSourcePathname(input.currentPathname)
	) {
		return input.href;
	}
	const params = new URLSearchParams(input.currentSearch);
	params.delete("item");
	params.delete("requestId");
	for (const [key, value] of new URLSearchParams(search)) {
		params.set(key, value);
	}
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

/** The conversation an Agent's question came from, focused on it. */
export function buildInboxAgentInteractionConversationHref(input: {
	orgSlug: string;
	target: Extract<InboxItem["sourceTarget"], { kind: "agent_interaction" }>;
}): string {
	return buildOrganizationSpacePath({
		orgSlug: input.orgSlug,
		search: {
			focusInteractionId: input.target.interactionId,
			focusSignalId: input.target.sourceSignalId,
			focusThreadRootSignalId: input.target.threadRootSignalId ?? undefined,
		},
		spaceId: input.target.spaceId,
	});
}

export function isInboxItemSourceLocation(input: {
	item: InboxItem;
	orgSlug: string;
	pathname: string | null;
	visibleConversation: InboxVisibleConversation | null;
}): boolean {
	const target = input.item.sourceTarget;
	if (
		target.kind === "center_agent" ||
		target.kind === "space" ||
		target.kind === "agent_interaction"
	) {
		return isInboxItemVisibleConversation(
			input.item,
			input.visibleConversation
		);
	}
	if (!input.pathname) {
		return false;
	}
	let sourceHref: string;
	try {
		sourceHref = buildInboxItemSourceNavigation({
			item: input.item,
			orgSlug: input.orgSlug,
		}).href;
	} catch (error) {
		console.warn("[openmeld.web.inbox.source_location_resolution_failed]", {
			error: error instanceof Error ? error.name : typeof error,
			itemId: input.item.id,
			organizationId: input.item.organizationId,
			targetKind: String(input.item.sourceTarget.kind),
		});
		return false;
	}
	const sourcePathname = sourceHref.split("?", 1)[0] ?? sourceHref;
	return (
		normalizeSourcePathname(sourcePathname) ===
		normalizeSourcePathname(input.pathname)
	);
}

const TRAILING_SLASHES_PATTERN = /\/+$/;
const INBOX_PATHNAME_PATTERN = /^\/o\/[^/]+\/inbox$/;

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
