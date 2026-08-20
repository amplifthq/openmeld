import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { DesktopTowerIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import {
	FEISHU_CHANNEL_IDENTITY,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";

const DIRECTORY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
});

const DIRECTORY_RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en-US", {
	numeric: "auto",
});

const MINUTE_IN_MS = 60_000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export function DirectoryComputerSummary(input: {
	member: DirectoryHumanProfileRow;
	size?: "card" | "detail";
}) {
	const content = (
		<>
			<DesktopTowerIcon
				aria-hidden="true"
				className={cn(
					input.size === "detail" ? "size-5" : "size-4",
					"shrink-0",
					resolveDirectoryComputerToneClassName(input.member.computer.state)
				)}
			/>
			<span>{input.member.computer.label}</span>
		</>
	);
	const className = cn(
		"inline-flex min-w-0 items-center gap-2",
		input.size === "detail" ? "text-sm" : "text-xs"
	);
	if (!input.member.computer.path) {
		return (
			<div className={cn(className, "text-muted-foreground")}>{content}</div>
		);
	}
	return (
		<Link
			aria-label={`${input.member.name}: ${input.member.computer.label}`}
			className={cn(
				className,
				"transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			)}
			to={input.member.computer.path}
		>
			{content}
		</Link>
	);
}

export function DirectoryIdentityLogo(input: {
	account: Pick<DirectoryIdentityAccount, "provider" | "providerLabel">;
	className?: string;
	muted?: boolean;
	size?: "sm" | "md";
}) {
	return (
		<span aria-label={input.account.providerLabel} role="img">
			<AppLogo
				app={resolveChannelIdentity(input.account.provider)}
				className={input.className}
				muted={input.muted}
				size={input.size ?? "sm"}
			/>
		</span>
	);
}

export function DirectoryIdentityAccountSummary(input: {
	account: DirectoryIdentityAccount;
	context: "card" | "detail";
}) {
	const label = resolveDirectoryIdentityAccountLabel(input.account);
	const showLabel =
		input.context === "detail" || input.account.state !== "not_connected";
	return (
		<div className="inline-flex min-w-0 items-center gap-2">
			<DirectoryIdentityLogo
				account={input.account}
				className={input.context === "card" ? "size-5 rounded-sm" : undefined}
				muted={input.account.state !== "connected"}
				size={input.context === "card" ? "sm" : "md"}
			/>
			{showLabel ? (
				<span
					className={cn(
						"min-w-0 break-all",
						input.context === "detail" ? "text-sm" : "text-xs",
						input.account.state === "unavailable"
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground"
					)}
				>
					{label}
				</span>
			) : null}
		</div>
	);
}

export function formatDirectoryActivity(
	lastUsedAt: string | null,
	nowMs = Date.now()
): string {
	if (!lastUsedAt) {
		return "Activity unavailable";
	}
	const timestamp = new Date(lastUsedAt);
	if (Number.isNaN(timestamp.getTime())) {
		return "Activity unavailable";
	}
	const elapsedMs = nowMs - timestamp.getTime();
	if (elapsedMs < MINUTE_IN_MS) {
		return "Last used just now";
	}
	if (elapsedMs < HOUR_IN_MS) {
		return `Last used ${DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / MINUTE_IN_MS),
			"minute"
		)}`;
	}
	if (elapsedMs < DAY_IN_MS) {
		return `Last used ${DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / HOUR_IN_MS),
			"hour"
		)}`;
	}
	if (elapsedMs < 7 * DAY_IN_MS) {
		return `Last used ${DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / DAY_IN_MS),
			"day"
		)}`;
	}
	return `Last used ${DIRECTORY_DATE_FORMATTER.format(timestamp)}`;
}

export function formatDirectoryDate(value: string | null): string {
	if (!value) {
		return "Unavailable";
	}
	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) {
		return "Unavailable";
	}
	return DIRECTORY_DATE_FORMATTER.format(timestamp);
}

export function resolveDirectoryIdentityAccountLabel(
	account: DirectoryIdentityAccount
): string {
	switch (account.state) {
		case "connected":
			return account.accountEmail ?? "Account email unavailable";
		case "unavailable":
			return "Connection unavailable";
		default:
			return "No account connected";
	}
}

export function resolveDirectoryRoleLabel(
	role: DirectoryHumanProfileRow["role"]
): string {
	switch (role) {
		case "admin":
			return "Admin";
		case "member":
			return "Member";
		case "owner":
			return "Owner";
		default:
			return "Role unavailable";
	}
}

export function resolveDirectoryComputerToneClassName(
	state: DirectoryHumanProfileRow["computer"]["state"]
): string {
	switch (state) {
		case "connected":
			return resolveStatusToneTextClassName("ready");
		case "needs_attention":
			return resolveStatusToneTextClassName("warning");
		case "checking":
			return resolveStatusToneTextClassName("checking");
		default:
			return resolveStatusToneTextClassName("muted");
	}
}

function resolveChannelIdentity(
	provider: DirectoryIdentityAccount["provider"]
) {
	switch (provider) {
		case "slack":
			return SLACK_CHANNEL_IDENTITY;
		case "lark":
			return LARK_CHANNEL_IDENTITY;
		case "feishu":
			return FEISHU_CHANNEL_IDENTITY;
		default:
			throw new Error(`Unsupported Message Channel provider: ${provider}`);
	}
}
