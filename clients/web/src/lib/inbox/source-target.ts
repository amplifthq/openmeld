import type { InboxItem } from "@openmeld/schemas/types";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentTaskPath,
	buildOrganizationComputersPath,
	buildOrganizationDocumentPath,
	buildOrganizationNotificationsSettingsPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";

export function buildInboxItemSourcePath(input: {
	item: InboxItem;
	orgSlug: string;
}): string {
	const target = input.item.sourceTarget;
	switch (target.kind) {
		case "space":
			return buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				search: {
					focusSignalId: target.signalId,
					focusThreadRootSignalId: target.threadRootSignalId,
				},
				spaceId: target.spaceId,
			});
		case "agent_interaction":
			return buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				search: {
					focusInteractionId: target.interactionId,
					focusSignalId: target.sourceSignalId,
				},
				spaceId: target.spaceId,
			});
		case "organization_document":
			return buildOrganizationDocumentPath({
				documentId: target.documentId,
				orgSlug: input.orgSlug,
			});
		case "center_agent":
			return buildOrganizationCenterAgentChatPath(input.orgSlug, {
				focusSignalId: target.signalId,
			});
		case "center_agent_task":
			return buildOrganizationCenterAgentTaskPath({
				orgSlug: input.orgSlug,
				taskId: target.taskId,
			});
		case "settings":
			return target.section === "computers"
				? buildOrganizationComputersPath(input.orgSlug)
				: buildOrganizationNotificationsSettingsPath(input.orgSlug);
		default:
			return assertNever(target);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Inbox source target: ${JSON.stringify(value)}`);
}
