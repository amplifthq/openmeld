export type AuthMode = "better-auth";

export function getAuthMode(): AuthMode {
	return "better-auth";
}

export function isBetterAuthMode(): boolean {
	return getAuthMode() === "better-auth";
}
