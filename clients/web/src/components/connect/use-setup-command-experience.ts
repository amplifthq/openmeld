"use client";

import { useMemo } from "react";
import { useGeneratedSetupCommand } from "./use-generated-setup-command";
import { useStartSetupCommandWatcher } from "./use-start-setup-command-watcher";

const SETUP_COMMAND_WAITING_STATUS_TEXT =
	"Run the command in Terminal. OpenMeld is waiting for this computer...";

export function useSetupCommandExperience(input: {
	buildCommand: (oneTimeToken: string) => Promise<null | string>;
	commandEnabled: boolean;
	commandKey: string | null;
	errorMessage: string;
	onCheckNow: () => Promise<void>;
	stopWatching: boolean;
	watchStrategy?: "after_setup_attempt" | "while_command_available";
}) {
	const generatedCommand = useGeneratedSetupCommand({
		buildCommand: input.buildCommand,
		commandKey: input.commandKey,
		enabled: input.commandEnabled,
		errorMessage: input.errorMessage,
	});
	const shouldWatch =
		input.watchStrategy === "while_command_available"
			? generatedCommand.hasCommand
			: generatedCommand.hasSetupAttemptStarted && generatedCommand.hasCommand;
	const watcher = useStartSetupCommandWatcher({
		enabled: input.commandEnabled && shouldWatch,
		isExpired: generatedCommand.isExpired,
		onCheckNow: input.onCheckNow,
		stopWhen: input.stopWatching || !input.commandEnabled,
	});
	const statusText = useMemo(() => {
		if (generatedCommand.isExpired) {
			return "This command expired. Copy a fresh command before running it.";
		}
		if (generatedCommand.hasCommand) {
			return SETUP_COMMAND_WAITING_STATUS_TEXT;
		}

		return watcher.statusText;
	}, [
		generatedCommand.hasCommand,
		generatedCommand.isExpired,
		watcher.statusText,
	]);
	const statusTextIsShimmering =
		statusText === SETUP_COMMAND_WAITING_STATUS_TEXT;
	const secondaryStatusText = watcher.lastCheckedAtMs
		? "Last checked just now."
		: null;

	return {
		...generatedCommand,
		checkNow: watcher.checkNow,
		isChecking: watcher.isChecking,
		isWatching: watcher.isWatching,
		lastCheckedAtMs: watcher.lastCheckedAtMs,
		secondaryStatusText,
		statusText,
		statusTextIsShimmering,
	};
}
