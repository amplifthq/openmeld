import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";

const DIRECTORY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
});

const DIRECTORY_RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en-US", {
	numeric: "auto",
});

const MINUTE_IN_MS = 60_000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export function formatDirectoryActivity(
	lastActiveAt: string | null,
	nowMs = Date.now()
): string | null {
	if (!lastActiveAt) {
		return null;
	}
	const timestamp = new Date(lastActiveAt);
	if (Number.isNaN(timestamp.getTime())) {
		return null;
	}
	const elapsedMs = nowMs - timestamp.getTime();
	if (elapsedMs < MINUTE_IN_MS) {
		return "just now";
	}
	if (elapsedMs < HOUR_IN_MS) {
		return DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / MINUTE_IN_MS),
			"minute"
		);
	}
	if (elapsedMs < DAY_IN_MS) {
		return DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / HOUR_IN_MS),
			"hour"
		);
	}
	if (elapsedMs < 7 * DAY_IN_MS) {
		return DIRECTORY_RELATIVE_TIME_FORMATTER.format(
			-Math.round(elapsedMs / DAY_IN_MS),
			"day"
		);
	}
	return DIRECTORY_DATE_FORMATTER.format(timestamp);
}

export function resolveDirectoryHumanProfileActivityTooltipLabel(input: {
	lastActiveAt: string | null;
	nowMs?: number;
	profileStatus: DirectoryHumanProfileRow["profileStatus"];
}): string | null {
	if (input.profileStatus !== "active") {
		return null;
	}
	const activityLabel = formatDirectoryActivity(
		input.lastActiveAt,
		input.nowMs
	);
	return activityLabel ? `Last seen ${activityLabel}` : null;
}

export function resolveDirectoryHumanProfileActivityLabel(input: {
	lastActiveAt: string | null;
	nowMs?: number;
	profileStatus: DirectoryHumanProfileRow["profileStatus"];
}): string | null {
	if (input.profileStatus === "disabled") {
		return "Profile disabled";
	}
	if (input.profileStatus === null) {
		return "Human Profile unavailable";
	}
	return formatDirectoryActivity(input.lastActiveAt, input.nowMs);
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

export function resolveDirectoryEmailLabel(email: string | null): string {
	return email?.trim() || "Email unavailable";
}

export function resolveDirectoryIdentityAccountLabel(
	account: DirectoryIdentityAccount
): string {
	switch (account.state) {
		case "connected":
			return (
				resolveDirectoryIdentityAccountIdentity(account) ??
				"Account details unavailable"
			);
		case "unavailable":
			return "Connection unavailable";
		default:
			return "No account connected";
	}
}

export function resolveDirectoryIdentityAccountCardLabel(
	account: DirectoryIdentityAccount
): string | null {
	return account.state === "connected"
		? resolveDirectoryIdentityAccountIdentity(account)
		: null;
}

export function resolveDirectoryIdentityAccountIdentity(
	account: Pick<DirectoryIdentityAccount, "accountEmail" | "accountName">
): string | null {
	const email = account.accountEmail?.trim() || null;
	const rawName = account.accountName?.trim() || null;
	const nameLooksLikeEmail = rawName?.includes("@") && !rawName.startsWith("@");
	const distinctName =
		rawName &&
		!nameLooksLikeEmail &&
		rawName.toLowerCase() !== email?.toLowerCase()
			? rawName
			: null;
	return [distinctName, email].filter(Boolean).join(" · ") || null;
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

export function resolveDirectoryComputerStatusTone(
	state: DirectoryHumanProfileRow["computer"]["state"]
): StatusTone {
	switch (state) {
		case "connected":
			return "ready";
		case "needs_attention":
			return "warning";
		case "not_connected":
			return "danger";
		case "checking":
			return "checking";
		default:
			return "muted";
	}
}
