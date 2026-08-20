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
