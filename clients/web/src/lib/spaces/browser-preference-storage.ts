type BrowserPreferenceStorageOperation = "read" | "remove" | "write";

export function readBrowserPreference(storageKey: string): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		return window.localStorage.getItem(storageKey);
	} catch (error) {
		reportBrowserPreferenceStorageFailure({
			error,
			operation: "read",
			storageKey,
		});
		return null;
	}
}

export function removeBrowserPreference(storageKey: string): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.removeItem(storageKey);
	} catch (error) {
		reportBrowserPreferenceStorageFailure({
			error,
			operation: "remove",
			storageKey,
		});
	}
}

export function writeBrowserPreference(
	storageKey: string,
	value: string
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(storageKey, value);
	} catch (error) {
		reportBrowserPreferenceStorageFailure({
			error,
			operation: "write",
			storageKey,
		});
	}
}

function reportBrowserPreferenceStorageFailure(input: {
	error: unknown;
	operation: BrowserPreferenceStorageOperation;
	storageKey: string;
}): void {
	console.warn("Space preference storage is unavailable in this browser.", {
		errorName: resolveErrorName(input.error),
		operation: input.operation,
		storageKey: input.storageKey,
	});
}

function resolveErrorName(error: unknown): string {
	if (error instanceof Error && error.name.trim()) {
		return error.name;
	}
	return "UnknownError";
}
