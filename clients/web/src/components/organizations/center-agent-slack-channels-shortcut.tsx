"use client";

import type { CenterAgentSlackWorkspaceConnection } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { CheckCircleIcon, LinkIcon } from "@phosphor-icons/react";
import { buildOrganizationChannelsPath } from "#/lib/organizations/organization-routes";
import { CenterAgentSlackConnectionDialog } from "./center-agent-slack-connection-dialog";

export function CenterAgentSlackChannelsShortcut(input: {
	organizationSlug: string;
	slackConnection?: CenterAgentSlackWorkspaceConnection;
}) {
	const connected = input.slackConnection?.connected === true;

	return (
		<CenterAgentSlackConnectionDialog
			managementPath={buildOrganizationChannelsPath(input.organizationSlug)}
			mode="channels-handoff"
			organizationSlug={input.organizationSlug}
			slackConnection={input.slackConnection}
			trigger={
				<Button size="sm" type="button" variant="ghost">
					{connected ? (
						<CheckCircleIcon aria-hidden="true" data-icon="inline-start" />
					) : (
						<LinkIcon aria-hidden="true" data-icon="inline-start" />
					)}
					{connected ? "Slack connected" : "Connect Slack"}
				</Button>
			}
		/>
	);
}
