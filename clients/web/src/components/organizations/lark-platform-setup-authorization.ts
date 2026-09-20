import type {
	LarkPlatformProvider,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";

export function requiresLarkPlatformSetupAuthorization(input: {
	provider: LarkPlatformProvider;
	reasonCode?: string | null;
	status?: MessageChannelConnectionProjection["status"];
}): boolean {
	if (input.status === "connected") {
		return (
			input.reasonCode === `${input.provider}.authorization_update_required`
		);
	}
	return (
		(input.status === "credentials_received" ||
			input.status === "configuring") &&
		(input.reasonCode ===
			`${input.provider}.application_config_permission_required` ||
			input.reasonCode === `${input.provider}.authorization_update_required` ||
			input.reasonCode === `${input.provider}.permission_bundle_mismatch`)
	);
}
