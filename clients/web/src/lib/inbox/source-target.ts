import type { InboxItem } from "@openmeld/schemas/types";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentTaskPath,
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
				href:
					target.section === "computers"
						? buildOrganizationComputersPath(input.orgSlug)
						: buildOrganizationNotificationsSettingsPath(input.orgSlug),
				openInNewTab: false,
			};
		default:
			return assertNever(target);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Inbox source target: ${JSON.stringify(value)}`);
}
