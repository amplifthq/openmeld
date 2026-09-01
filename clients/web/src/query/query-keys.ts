export const userQueryKeys = {
	accountAvatar: ["user", "account-avatar"] as const,
	session: ["user", "session"] as const,
	listSessions: ["user", "list-sessions"] as const,
	listUserAccounts: ["user", "list-user-accounts"] as const,
	passkeys: ["user", "passkeys"] as const,
} as const;

export const startQueryKeys = {
	allProfiles: ["start", "profiles"] as const,
	allAccountProfiles: ["start", "account-profiles"] as const,
	allHumanProfiles: ["start", "human-profiles"] as const,
	profileCapabilities: ["start", "profile-capabilities"] as const,
	currentDeviceTarget: (storageScope: string) =>
		[
			"start",
			"current-device-target",
			normalizeQueryScope(storageScope),
		] as const,
	localRuntimes: (storageScope: string) =>
		["start", "local-runtimes", normalizeQueryScope(storageScope)] as const,
	currentLocalRuntimeReplyReadiness: (storageScope: string) =>
		[
			"start",
			"current-local-runtime-reply-readiness",
			normalizeQueryScope(storageScope),
		] as const,
	currentComputerToolbarDisplaySnapshot: (storageScope: string) =>
		[
			"start",
			"current-computer-toolbar-display-snapshot",
			normalizeQueryScope(storageScope),
		] as const,
	prepareSession: (storageScope: string, prepareSessionId: string) =>
		[
			"start",
			"prepare-session",
			normalizeQueryScope(storageScope),
			prepareSessionId,
		] as const,
	profiles: (storageScope: string, deviceId: string) =>
		[
			...startQueryKeys.allProfiles,
			normalizeQueryScope(storageScope),
			deviceId,
		] as const,
	profilesForStorageScope: (storageScope: string) =>
		[...startQueryKeys.allProfiles, normalizeQueryScope(storageScope)] as const,
	accountProfiles: (storageScope: string) =>
		[
			...startQueryKeys.allAccountProfiles,
			normalizeQueryScope(storageScope),
		] as const,
	humanProfiles: (storageScope: string) =>
		[
			...startQueryKeys.allHumanProfiles,
			normalizeQueryScope(storageScope),
		] as const,
} as const;

export const configQueryKeys = {
	modelCatalog: ["config", "model-catalog"] as const,
} as const;

function normalizeQueryScope(storageScope: string | null | undefined): string {
	const normalizedScope = (storageScope ?? "").trim();
	return normalizedScope.length > 0 ? normalizedScope : "anonymous";
}
