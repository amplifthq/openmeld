import type {
	LarkPlatformProvider,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";

export function requiresLarkPlatformSetupAuthorization(input: {
	provider: LarkPlatformProvider;
	reasonCode?: string | null;
	status?: MessageChannelConnectionProjection["status"];
}): boolean {
	return (
		(input.status === "credentials_received" ||
			input.status === "configuring") &&
		input.reasonCode ===
			`${input.provider}.application_config_permission_required`
	);
}
