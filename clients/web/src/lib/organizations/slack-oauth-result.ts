import type { SlackOAuthErrorCode } from "@openmeld/schemas/types";

export type SlackOAuthResult =
	| { status: "connected" }
	| {
			fromOrganizationId: string;
			fromOrganizationName: string;
			status: "move_required";
	  }
	| { error: SlackOAuthErrorCode; status: "error" };

export type SlackOAuthResultMessage = {
	description: string;
	title: string;
	tone: "success" | "error";
};

export function resolveVisibleChannelsSlackOAuthResult(input: {
	result?: SlackOAuthResult;
	slackConnected: boolean;
}): SlackOAuthResult | undefined {
	return input.result?.status === "connected" && !input.slackConnected
		? undefined
		: input.result;
}

export function resolveSlackOAuthResultMessage(
	result: SlackOAuthResult
): SlackOAuthResultMessage {
	if (result.status === "connected") {
		return {
			description:
				"Members can now mention the Center Agent from this Slack workspace.",
			title: "Slack connected",
			tone: "success",
		};
	}
	if (result.status === "move_required") {
		return {
			description:
				"Confirm the move to finish connecting this Slack workspace.",
			title: "Slack workspace move needs confirmation",
			tone: "error",
		};
	}

	switch (result.error) {
		case "access_denied":
			return {
				description:
					"No changes were made. Choose Add to Slack when you are ready to try again.",
				title: "Slack connection canceled",
				tone: "error",
			};
		case "configuration_missing":
			return {
				description:
					"Ask an OpenMeld administrator to finish the Slack OAuth configuration, then try again.",
				title: "Slack connection is not configured",
				tone: "error",
			};
		case "expired_state":
			return {
				description:
					"Start again from Connect Slack so OpenMeld can create a new secure connection request.",
				title: "This Slack connection link expired",
				tone: "error",
			};
		case "invalid_state":
			return {
				description:
					"Start again from Connect Slack so OpenMeld can create a new secure connection request.",
				title: "This Slack connection request is invalid",
				tone: "error",
			};
		case "organization_already_bound":
			return {
				description:
					"Disconnect its current Slack workspace before connecting a different one.",
				title: "This organization already has a Slack workspace",
				tone: "error",
			};
		case "organization_required":
			return {
				description:
					"Your Personal Workspace is for you only and cannot connect Slack. Create or choose an organization, then connect Slack there.",
				title: "Create an organization to connect Slack",
				tone: "error",
			};
		case "workspace_already_bound":
			return {
				description:
					"Ask the administrator who previously connected this Slack workspace to OpenMeld for help.",
				title:
					"That Slack workspace is connected to another organization you don't belong to",
				tone: "error",
			};
		case "missing_code":
		case "oauth_exchange_failed":
			return {
				description:
					"Try Add to Slack again. If the problem continues, ask an OpenMeld administrator to check the Slack app configuration.",
				title: "Slack could not authorize this connection",
				tone: "error",
			};
		case "installation_failed":
			return {
				description:
					"Try Add to Slack again. If the problem continues, ask an OpenMeld administrator to review the connection logs.",
				title: "OpenMeld could not finish connecting Slack",
				tone: "error",
			};
		case "state_creation_failed":
			return {
				description:
					"Refresh the page and try again. Make sure you are still an organization owner or admin.",
				title: "OpenMeld could not start the Slack connection",
				tone: "error",
			};
		case "state_validation_failed":
			return {
				description:
					"Start again from Connect Slack so OpenMeld can verify a new secure connection request.",
				title: "OpenMeld could not verify this Slack connection",
				tone: "error",
			};
		default:
			return assertNeverSlackOAuthError(result.error);
	}
}

function assertNeverSlackOAuthError(error: never): never {
	throw new Error(`Unhandled Slack OAuth error code: ${String(error)}`);
}
