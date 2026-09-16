import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export const CLIENT_VERSION_RECOVERY_ATTEMPT_KEY =
	"openmeld.client-version-recovery-attempt";
export const CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS = 30_000;
export const CLIENT_VERSION_RECOVERY_NAVIGATION_TIMEOUT_MS = 15_000;

type ClientVersionRecoveryState =
	| { status: "idle" }
	| { status: "reloading" | "failed"; error: Error };

const idleState: ClientVersionRecoveryState = { status: "idle" };
let recoveryState: ClientVersionRecoveryState = idleState;
const listeners = new Set<() => void>();
const reloadBlockers = new Set<() => boolean>();
let navigationTimeout: ReturnType<typeof setTimeout> | undefined;

export function resetClientVersionRecovery() {
	clearTimeout(navigationTimeout);
	navigationTimeout = undefined;
	if (recoveryState.status !== "idle") {
		publishState(idleState);
	}
}

// Editable surfaces retain ownership of their unsaved work. Recovery must not
// unmount their native navigation guards before asking the browser to reload.
export function registerClientVersionRecoveryBlocker(blocker: () => boolean) {
	reloadBlockers.add(blocker);
	return () => {
		reloadBlockers.delete(blocker);
	};
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useClientVersionRecovery() {
	return useSyncExternalStore(
		subscribe,
		() => recoveryState,
		() => idleState
	);
}

function publishState(state: ClientVersionRecoveryState) {
	recoveryState = state;
	// Vite rejects the import immediately after its event. Commit the recovery
	// surface first so the failed route cannot render or start its own reload.
	flushSync(() => {
		for (const listener of listeners) {
			listener();
		}
	});
}

export function isClientAssetLoadError(error: unknown): boolean {
	let message = typeof error === "string" ? error : "";
	if (error instanceof Error) {
		message = error.message;
	}
	return [
		"error loading dynamically imported module",
		"failed to fetch dynamically imported module",
		"importing a module script failed",
		"unable to preload css for",
	].some((fragment) => message.toLowerCase().includes(fragment));
}

export function installClientVersionRecovery(input: {
	now: () => number;
	reload: () => void;
	window: Window;
}): () => void {
	const onPreloadError = (event: Event) => {
		const payload: unknown = (event as Event & { payload?: unknown }).payload;
		if (!isClientAssetLoadError(payload) || recoveryState.status !== "idle") {
			return;
		}
		const error =
			payload instanceof Error ? payload : new Error(String(payload));
		if ([...reloadBlockers].some((isBlocked) => isBlocked())) {
			console.warn("[openmeld.web.client_version_recovery_deferred]", {
				reason: "unsaved_work",
			});
			return;
		}
		const fail = () => publishState({ status: "failed", error });
		const now = input.now();
		let previousAttempt: number;
		try {
			previousAttempt = Number.parseInt(
				input.window.sessionStorage.getItem(
					CLIENT_VERSION_RECOVERY_ATTEMPT_KEY
				) ?? "",
				10
			);
		} catch (error) {
			console.error("[openmeld.web.client_version_recovery_storage_failed]", {
				error,
				operation: "read",
			});
			fail();
			return;
		}
		if (
			Number.isFinite(previousAttempt) &&
			now - previousAttempt < CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS
		) {
			console.error("[openmeld.web.client_version_recovery_exhausted]", {
				retryWindowMs: CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS,
			});
			fail();
			return;
		}

		try {
			input.window.sessionStorage.setItem(
				CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
				String(now)
			);
		} catch (error) {
			console.error("[openmeld.web.client_version_recovery_storage_failed]", {
				error,
				operation: "write",
			});
			fail();
			return;
		}

		console.warn("[openmeld.web.client_version_recovery_reload]", {
			reason: "vite_preload_error",
		});
		publishState({ status: "reloading", error });
		// A canceled or stalled document navigation must not leave an endless
		// loading surface. This only bounds recovery UI, never Agent execution.
		navigationTimeout = setTimeout(
			fail,
			CLIENT_VERSION_RECOVERY_NAVIGATION_TIMEOUT_MS
		);
		// Keep Vite's original rejection while navigation is pending. Canceling
		// the event resolves a failed import with undefined, which makes lazy
		// route components throw a second error when reading their export.
		try {
			input.reload();
		} catch (reloadError) {
			clearTimeout(navigationTimeout);
			console.error("[openmeld.web.client_version_recovery_reload_failed]", {
				error: reloadError,
			});
			fail();
		}
	};

	input.window.addEventListener("vite:preloadError", onPreloadError);
	return () => {
		input.window.removeEventListener("vite:preloadError", onPreloadError);
		resetClientVersionRecovery();
	};
}
