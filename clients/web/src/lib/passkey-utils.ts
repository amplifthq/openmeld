const MAX_PASSKEY_NAME_LENGTH = 64;

function getBrowserName(): string {
	if (typeof navigator === "undefined") {
		return "Server";
	}

	const userAgent = navigator.userAgent;
	if (userAgent.includes("Edg/")) {
		return "Edge";
	}
	if (userAgent.includes("Chrome/")) {
		return "Chrome";
	}
	if (userAgent.includes("Safari/") && !userAgent.includes("Chrome/")) {
		return "Safari";
	}
	if (userAgent.includes("Firefox/")) {
		return "Firefox";
	}

	return "Browser";
}

function getPlatformName(): string {
	if (typeof navigator === "undefined") {
		return "Unknown OS";
	}

	const maybeUserAgentData = navigator as Navigator & {
		userAgentData?: { platform?: string };
	};

	return (
		maybeUserAgentData.userAgentData?.platform ??
		navigator.platform ??
		"Unknown OS"
	);
}

export function generatePasskeyName(): string {
	const envSuffix = import.meta.env.DEV ? " (dev)" : "";
	const value = `${getBrowserName()} - ${getPlatformName()}${envSuffix}`;
	return value.slice(0, MAX_PASSKEY_NAME_LENGTH);
}

export function getPasskeyDeviceLabel(deviceType?: string | null): string {
	switch (deviceType) {
		case "singleDevice":
			return "Only on this device";
		case "multiDevice":
			return "Synced across devices";
		default:
			return "Unknown device type";
	}
}
