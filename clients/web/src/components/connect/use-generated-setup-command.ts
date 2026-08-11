"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGenerateOneTimeToken } from "#/hooks/account.hooks";
import { copyCliEntryCommand } from "#/lib/cli-entry-command";
import { DEFAULT_ONE_TIME_TOKEN_EXPIRES_IN_SECONDS } from "#/lib/one-time-token-expiry";

type GeneratedSetupCommandState = {
	command: string | null;
	commandKey: string | null;
	copyStatus: "idle" | "copied" | "manual";
	errorMessage: string | null;
	expiresAtMs: number | null;
	hasLoadedForKey: boolean;
	hasSetupAttemptStarted: boolean;
	isLoading: boolean;
};

function createIdleState(
	commandKey: string | null = null
): GeneratedSetupCommandState {
	return {
		command: null,
		commandKey,
		copyStatus: "idle",
		errorMessage: null,
		expiresAtMs: null,
		hasLoadedForKey: false,
		hasSetupAttemptStarted: false,
		isLoading: false,
	};
}

function formatCountdown(totalSeconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(totalSeconds));
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resolveRefreshErrorMessage(error: unknown, fallbackMessage: string) {
	return error instanceof Error ? error.message : fallbackMessage;
}

function resolveTokenExpiryInSeconds(expiresIn: number | undefined) {
	return typeof expiresIn === "number" && expiresIn > 0
		? expiresIn
		: DEFAULT_ONE_TIME_TOKEN_EXPIRES_IN_SECONDS;
}

export function useGeneratedSetupCommand(input: {
	buildCommand: (oneTimeToken: string) => Promise<null | string>;
	commandKey: string | null;
	enabled: boolean;
	errorMessage: string;
}) {
	const { buildCommand, commandKey, enabled, errorMessage } = input;
	const generateOneTimeToken = useGenerateOneTimeToken();
	const generateOneTimeTokenMutateAsync = generateOneTimeToken.mutateAsync;
	const [now, setNow] = useState(() => Date.now());
	const [state, setState] = useState<GeneratedSetupCommandState>(
		createIdleState()
	);
	const refreshInputRef = useRef({
		buildCommand,
		commandKey,
		enabled,
		errorMessage,
		generateOneTimeTokenMutateAsync,
	});
	const refreshInFlightRef = useRef<null | {
		commandKey: string;
		promise: Promise<null | string>;
	}>(null);

	refreshInputRef.current = {
		buildCommand,
		commandKey,
		enabled,
		errorMessage,
		generateOneTimeTokenMutateAsync,
	};

	useEffect(() => {
		if (state.expiresAtMs === null) {
			return;
		}

		const timer = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => {
			window.clearInterval(timer);
		};
	}, [state.expiresAtMs]);

	const remainingSeconds = useMemo(() => {
		if (state.expiresAtMs === null) {
			return null;
		}

		const remaining = Math.ceil((state.expiresAtMs - now) / 1000);
		return remaining > 0 ? remaining : 0;
	}, [now, state.expiresAtMs]);

	const refreshCommand = useCallback(async () => {
		const refreshInput = refreshInputRef.current;
		if (!refreshInput.enabled || refreshInput.commandKey === null) {
			return null;
		}

		const refreshInFlight = refreshInFlightRef.current;
		if (refreshInFlight?.commandKey === refreshInput.commandKey) {
			return await refreshInFlight.promise;
		}

		const refreshCommandKey = refreshInput.commandKey;

		let refreshPromise!: Promise<null | string>;
		refreshPromise = (async () => {
			setState((current) => ({
				...current,
				commandKey: refreshCommandKey,
				copyStatus: "idle",
				errorMessage: null,
				hasLoadedForKey: false,
				hasSetupAttemptStarted: false,
				isLoading: true,
			}));

			try {
				const payload = await refreshInput.generateOneTimeTokenMutateAsync();
				const nextCommand = await refreshInput.buildCommand(payload.token);
				const expiresInSeconds = resolveTokenExpiryInSeconds(payload.expiresIn);

				if (
					!refreshInputRef.current.enabled ||
					refreshInputRef.current.commandKey !== refreshCommandKey
				) {
					return null;
				}

				const refreshedAtMs = Date.now();
				setState((current) => ({
					...current,
					command: nextCommand,
					commandKey: refreshCommandKey,
					copyStatus: "idle",
					errorMessage: null,
					expiresAtMs: refreshedAtMs + expiresInSeconds * 1000,
					hasLoadedForKey: true,
					hasSetupAttemptStarted: false,
					isLoading: false,
				}));
				setNow(refreshedAtMs);
				return nextCommand;
			} catch (error) {
				if (
					!refreshInputRef.current.enabled ||
					refreshInputRef.current.commandKey !== refreshCommandKey
				) {
					return null;
				}

				setState((current) => ({
					...current,
					command: null,
					commandKey: refreshCommandKey,
					copyStatus: "idle",
					errorMessage: resolveRefreshErrorMessage(
						error,
						refreshInput.errorMessage
					),
					expiresAtMs: null,
					hasLoadedForKey: true,
					isLoading: false,
				}));
				return null;
			} finally {
				if (refreshInFlightRef.current?.promise === refreshPromise) {
					refreshInFlightRef.current = null;
				}
			}
		})();

		refreshInFlightRef.current = {
			commandKey: refreshCommandKey,
			promise: refreshPromise,
		};
		return await refreshPromise;
	}, []);

	const copyResolvedCommand = useCallback(async (command: string) => {
		const didCopy = await copyCliEntryCommand(command);
		setState((current) => ({
			...current,
			copyStatus: didCopy ? "copied" : "manual",
			hasSetupAttemptStarted: true,
		}));
	}, []);

	useEffect(() => {
		if (!enabled || commandKey === null) {
			setState(createIdleState());
			return;
		}

		if (state.commandKey !== commandKey) {
			setState(createIdleState(commandKey));
			refreshCommand().catch(() => undefined);
			return;
		}

		if (state.hasLoadedForKey) {
			return;
		}

		refreshCommand().catch(() => undefined);
	}, [
		commandKey,
		enabled,
		refreshCommand,
		state.commandKey,
		state.hasLoadedForKey,
	]);

	const copyCommand = useCallback(async () => {
		let commandToCopy = state.command;

		if (
			commandToCopy === null ||
			remainingSeconds === null ||
			remainingSeconds <= 0
		) {
			commandToCopy = await refreshCommand();
		}

		if (!commandToCopy) {
			return;
		}

		await copyResolvedCommand(commandToCopy);
	}, [copyResolvedCommand, refreshCommand, remainingSeconds, state.command]);

	const refreshAndCopyCommand = useCallback(async () => {
		const commandToCopy = await refreshCommand();
		if (!commandToCopy) {
			return;
		}

		await copyResolvedCommand(commandToCopy);
	}, [copyResolvedCommand, refreshCommand]);

	let expiresInLabel: string | null = null;
	if (remainingSeconds !== null) {
		expiresInLabel =
			remainingSeconds <= 0
				? "This command expired. Copy a fresh command before running it."
				: `Command expires in ${formatCountdown(remainingSeconds)}.`;
	}

	return {
		command: state.command,
		copyCommand,
		copyStatus: state.copyStatus,
		errorMessage: state.errorMessage,
		expiresInLabel,
		hasCommand: state.command !== null,
		hasSetupAttemptStarted: state.hasSetupAttemptStarted,
		isExpired: remainingSeconds !== null && remainingSeconds <= 0,
		isLoading: state.isLoading,
		remainingSeconds,
		refreshAndCopyCommand,
		refreshCommand,
	};
}
