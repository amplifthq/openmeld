import { Bars } from "@openmeld/ui/components/bars";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	DeviceMobileIcon,
	MonitorIcon,
	SignOutIcon,
	WifiHighIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	useAccountSession,
	useAccountSessions,
	useRevokeAllOtherSessions,
	useRevokeSession,
} from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { SessionsManagementCardSkeleton } from "./account-skeletons";

function formatDate(value: unknown): string {
	if (!value) {
		return "Unknown";
	}

	const date = new Date(String(value));
	if (Number.isNaN(date.getTime())) {
		return "Unknown";
	}

	return date.toLocaleString();
}

function readDeviceType(
	userAgent: string | null | undefined
): "mobile" | "desktop" {
	const value = (userAgent ?? "").toLowerCase();
	if (
		value.includes("iphone") ||
		value.includes("android") ||
		value.includes("ipad") ||
		value.includes("mobile")
	) {
		return "mobile";
	}

	return "desktop";
}

function buildAgentLabel(userAgent: string | null | undefined): string {
	if (!userAgent) {
		return "Unknown browser";
	}

	const normalized = userAgent.toLowerCase();
	if (normalized.includes("edg/")) {
		return "Edge";
	}
	if (normalized.includes("chrome/")) {
		return "Chrome";
	}
	if (normalized.includes("safari/") && !normalized.includes("chrome/")) {
		return "Safari";
	}
	if (normalized.includes("firefox/")) {
		return "Firefox";
	}

	return "Browser";
}

function sessionActionLabel({
	isRevoking,
	isCurrent,
}: {
	isRevoking: boolean;
	isCurrent: boolean;
}) {
	if (isRevoking) {
		return (
			<span className="inline-flex items-center gap-1">
				<Bars className="h-3.5 w-5" />
				Terminating…
			</span>
		);
	}

	if (isCurrent) {
		return (
			<span className="inline-flex items-center gap-1">
				<SignOutIcon className="size-3.5" />
				Log Out
			</span>
		);
	}

	return "Terminate";
}

export function SessionsManagementCard() {
	const { data: currentSessionData, isPending: isCurrentSessionPending } =
		useAccountSession();
	const { data: sessions = [], isPending: isSessionsPending } =
		useAccountSessions();
	const revokeSession = useRevokeSession();
	const revokeOtherSessions = useRevokeAllOtherSessions();

	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
		null
	);

	if (isCurrentSessionPending || isSessionsPending) {
		return <SessionsManagementCardSkeleton />;
	}

	const currentSession = currentSessionData?.session;
	if (!currentSession) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<WifiHighIcon className="size-5" />
						Sessions
					</CardTitle>
					<CardDescription>Unable to load session information.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const sortedSessions = [...sessions].sort((a, b) => {
		const aCurrent = a.id === currentSession.id;
		const bCurrent = b.id === currentSession.id;
		if (aCurrent && !bCurrent) {
			return -1;
		}
		if (!aCurrent && bCurrent) {
			return 1;
		}
		return 0;
	});

	const handleRevokeOtherSessionsClick = () => {
		setStatusMessage(null);
		revokeOtherSessions.mutateAsync().then(
			() => setStatusMessage("Other sessions revoked."),
			(error) => {
				setStatusMessage(
					getAuthErrorMessage(error, "Failed to revoke sessions.")
				);
			}
		);
	};

	const handleTerminateClick = (sessionToken: string, isCurrent: boolean) => {
		setStatusMessage(null);

		if (isCurrent) {
			window.location.assign("/logout");
			return;
		}

		setRevokingSessionId(sessionToken);
		revokeSession.mutateAsync(sessionToken).then(
			() => {
				setStatusMessage("Session terminated.");
				setRevokingSessionId(null);
			},
			(error) => {
				setStatusMessage(
					getAuthErrorMessage(error, "Failed to terminate session.")
				);
				setRevokingSessionId(null);
			}
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<WifiHighIcon className="size-5" />
					Sessions
				</CardTitle>
				<CardDescription>
					Manage your active sessions and connected devices.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between gap-3">
					<p className="font-medium text-xs">
						Connected sessions ({sessions.length})
					</p>
					<Button
						disabled={sessions.length <= 1 || revokeOtherSessions.isPending}
						onClick={handleRevokeOtherSessionsClick}
						size="sm"
						variant="outline"
					>
						{revokeOtherSessions.isPending
							? "Revoking…"
							: "Revoke other sessions"}
					</Button>
				</div>

				<div className="space-y-3">
					{sortedSessions.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							No active sessions found.
						</p>
					) : (
						sortedSessions.map((session, index) => {
							const isCurrent = session.id === currentSession.id;
							const isRevoking = revokingSessionId === session.token;
							const isMobile = readDeviceType(session.userAgent) === "mobile";
							const sessionKey =
								session.id ?? session.token ?? `${String(index)}-session`;

							return (
								<div
									className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
									key={sessionKey}
								>
									<div className="flex items-start gap-2">
										{isMobile ? (
											<DeviceMobileIcon className="mt-0.5 size-4 text-muted-foreground" />
										) : (
											<MonitorIcon className="mt-0.5 size-4 text-muted-foreground" />
										)}
										<div>
											<p className="font-medium text-xs">
												{buildAgentLabel(session.userAgent)}
												{isCurrent ? " (Current)" : ""}
											</p>
											<p className="text-muted-foreground text-xs">
												Last active {formatDate(session.updatedAt)}
											</p>
											{session.ipAddress ? (
												<p className="text-muted-foreground text-xs">
													IP: {session.ipAddress}
												</p>
											) : null}
										</div>
									</div>

									{isCurrent ? (
										<Link
											className={buttonVariants({
												size: "sm",
												variant: "outline",
											})}
											to="/logout"
										>
											{sessionActionLabel({ isCurrent, isRevoking })}
										</Link>
									) : (
										<Button
											disabled={revokeSession.isPending || isRevoking}
											onClick={() =>
												handleTerminateClick(session.token ?? "", isCurrent)
											}
											size="sm"
											variant="outline"
										>
											{sessionActionLabel({ isCurrent, isRevoking })}
										</Button>
									)}
								</div>
							);
						})
					)}
				</div>

				{statusMessage ? (
					<p className="text-muted-foreground text-xs">{statusMessage}</p>
				) : null}
			</CardContent>
		</Card>
	);
}
