import {
	buildWebSetupCommand,
	type WebSetupUserFacingCommand,
} from "#/lib/cli-entry-command";
import { copyTextToClipboard } from "#/lib/clipboard";

export type StartLocalHandoffCommandCopyStatus =
	| "copied"
	| "manual_copy_required";

export type StartLocalHandoffCommandSnapshot = {
	command: string;
	copyStatus: StartLocalHandoffCommandCopyStatus;
};

export type StartLocalHandoffUiState =
	| {
			kind: "idle";
			commandSnapshot: null;
	  }
	| {
			kind: "command_ready";
			commandSnapshot: StartLocalHandoffCommandSnapshot;
	  }
	| {
			kind: "waiting";
			commandSnapshot: StartLocalHandoffCommandSnapshot | null;
	  };

export function createIdleStartLocalHandoffUiState(): StartLocalHandoffUiState {
	return {
		kind: "idle",
		commandSnapshot: null,
	};
}

export function buildStartHandoffCommand(input: {
	authUrl?: string;
	opaqueToken: string;
	gatewayUrl?: string;
	oneTimeToken?: string;
	userFacingCommand?: WebSetupUserFacingCommand;
}): string {
	return buildWebSetupCommand({
		authUrl: input.authUrl,
		gatewayUrl: input.gatewayUrl,
		oneTimeToken: input.oneTimeToken,
		startSession: input.opaqueToken,
		userFacingCommand: input.userFacingCommand,
	});
}

export async function copyStartHandoffCommand(
	command: string
): Promise<StartLocalHandoffCommandCopyStatus> {
	return (await copyTextToClipboard(command))
		? "copied"
		: "manual_copy_required";
}
