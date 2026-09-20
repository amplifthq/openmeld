import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useGenerateOneTimeToken } from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { formatWebCliCommand } from "#/lib/cli-entry-command";
import { DEFAULT_ONE_TIME_TOKEN_EXPIRES_IN_SECONDS } from "#/lib/one-time-token-expiry";
import type { WebCliTargetInput } from "#/lib/web-cli-target";

type StatusMessage = {
	text: string;
	tone: "default" | "error";
};

type OneTimeTokenCommandDisplay = {
	alternateCommand: string | null;
	helperText: string;
	primaryCommand: string;
};

function formatCountdown(totalSeconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(totalSeconds));
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function tokenStatusText(remainingSeconds: number | null): string {
	if (remainingSeconds === null) {
		return "";
	}

	if (remainingSeconds <= 0) {
		return "Token expired. Generate a new one.";
	}

	return `Token expires in ${formatCountdown(remainingSeconds)}.`;
}

export function buildOneTimeTokenCommandDisplay(
	oneTimeToken: string | null,
	input: WebCliTargetInput = {}
): OneTimeTokenCommandDisplay {
	const tokenValue = oneTimeToken ?? "<token>";
	return {
		primaryCommand: formatWebCliCommand(
			`openmeld login --ott ${tokenValue}`,
			input
		),
		alternateCommand: null,
		helperText:
			"Use this command for the current OpenMeld environment. One-time tokens expire quickly and can only be used once, so generate a fresh token and use it immediately.",
	};
}

export function OneTimeTokenCard() {
	const generateOneTimeToken = useGenerateOneTimeToken();
	const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
	const [oneTimeTokenExpiresAt, setOneTimeTokenExpiresAt] = useState<
		number | null
	>(null);
	const [now, setNow] = useState(() => Date.now());
	const [message, setMessage] = useState<StatusMessage | null>(null);

	useEffect(() => {
		if (!oneTimeTokenExpiresAt) {
			return;
		}

		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => {
			clearInterval(timer);
		};
	}, [oneTimeTokenExpiresAt]);

	const oneTimeTokenRemainingSeconds = useMemo(() => {
		if (!oneTimeTokenExpiresAt) {
			return null;
		}

		const remainingSeconds = Math.ceil((oneTimeTokenExpiresAt - now) / 1000);
		return remainingSeconds > 0 ? remainingSeconds : 0;
	}, [oneTimeTokenExpiresAt, now]);

	const isTokenExpired =
		oneTimeTokenRemainingSeconds !== null && oneTimeTokenRemainingSeconds <= 0;

	const commandDisplay = useMemo(
		() => buildOneTimeTokenCommandDisplay(oneTimeToken),
		[oneTimeToken]
	);

	const handleGenerateTokenClick = async () => {
		setMessage(null);
		try {
			const payload = await generateOneTimeToken.mutateAsync();
			const expiresIn =
				typeof payload.expiresIn === "number" && payload.expiresIn > 0
					? payload.expiresIn
					: DEFAULT_ONE_TIME_TOKEN_EXPIRES_IN_SECONDS;

			setOneTimeToken(payload.token);
			setOneTimeTokenExpiresAt(Date.now() + expiresIn * 1000);
			setNow(Date.now());
			setMessage({
				text: "One-time token generated.",
				tone: "default",
			});
		} catch (error) {
			setMessage({
				text: getAuthErrorMessage(error, "Failed to generate one-time token."),
				tone: "error",
			});
		}
	};

	const handleCopyTokenClick = async () => {
		setMessage(null);

		if (!oneTimeToken || isTokenExpired) {
			toast.error("Generate one-time token first.");
			return;
		}

		if (typeof navigator === "undefined" || !navigator.clipboard) {
			toast.error("Clipboard API is unavailable.");
			return;
		}

		try {
			await navigator.clipboard.writeText(oneTimeToken);
			toast.success("One-time token copied.");
		} catch (error) {
			toast.error(getAuthErrorMessage(error, "Failed to copy one-time token."));
		}
	};

	const handleCopyCommandClick = async () => {
		if (!oneTimeToken || isTokenExpired) {
			toast.error("Generate a valid token first.");
			return;
		}

		if (typeof navigator === "undefined" || !navigator.clipboard) {
			toast.error("Clipboard API is unavailable.");
			return;
		}

		try {
			await navigator.clipboard.writeText(commandDisplay.primaryCommand);
			toast.success("CLI command copied.");
		} catch (error) {
			toast.error(getAuthErrorMessage(error, "Failed to copy CLI command."));
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>One-Time Token</CardTitle>
				<CardDescription>
					Use a one-time token to sign in on another computer, terminal, or
					agent.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="space-y-1">
					<p className="text-muted-foreground text-xs">One-time token</p>
					<button
						className={`block w-full cursor-pointer touch-manipulation break-all rounded-md border border-border bg-surface-2 p-2 text-left text-xs shadow-surface-1 transition-colors hover:bg-muted/30 max-lg:min-h-11 ${oneTimeToken ? "" : "text-muted-foreground/60"}`}
						onClick={handleCopyTokenClick}
						type="button"
					>
						{oneTimeToken ?? "generate one below"}
					</button>
					{tokenStatusText(oneTimeTokenRemainingSeconds) ? (
						<p className="text-muted-foreground text-xs">
							{tokenStatusText(oneTimeTokenRemainingSeconds)}
						</p>
					) : null}
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						disabled={generateOneTimeToken.isPending}
						onClick={handleGenerateTokenClick}
						size="sm"
						type="button"
						variant="outline"
					>
						{generateOneTimeToken.isPending
							? "Generating..."
							: "Generate token"}
					</Button>
				</div>

				<div className="space-y-1">
					<p className="text-muted-foreground text-xs">CLI command</p>
					<button
						className="block w-full cursor-pointer overflow-x-auto rounded-md border border-border bg-surface-2 p-2 text-left text-xs shadow-surface-1 transition-colors hover:bg-muted/30"
						onClick={handleCopyCommandClick}
						type="button"
					>
						{commandDisplay.primaryCommand}
					</button>
					<p className="text-muted-foreground text-xs">
						{commandDisplay.helperText}
					</p>
					{commandDisplay.alternateCommand ? (
						<div className="space-y-1">
							<p className="text-muted-foreground text-xs">Alternate command</p>
							<ScrollArea
								className="rounded-md border border-border bg-surface-2 shadow-surface-1"
								contentClassName="p-2 text-muted-foreground text-xs"
								orientation="horizontal"
							>
								{commandDisplay.alternateCommand}
							</ScrollArea>
						</div>
					) : null}
				</div>

				{message ? (
					<p
						className={
							message.tone === "error"
								? "text-destructive text-xs"
								: "text-muted-foreground text-xs"
						}
					>
						{message.text}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
