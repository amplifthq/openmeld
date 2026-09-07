export const CLIENT_VERSION_RECOVERY_ATTEMPT_KEY =
	"openmeld.client-version-recovery-attempt";
export const CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS = 30_000;

export function installClientVersionRecovery(input: {
	now: () => number;
	reload: () => void;
	window: Window;
}): () => void {
	const onPreloadError = () => {
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
			return;
		}
		if (
			Number.isFinite(previousAttempt) &&
			now - previousAttempt < CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS
		) {
			console.error("[openmeld.web.client_version_recovery_exhausted]", {
				retryWindowMs: CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS,
			});
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
			return;
		}

		console.warn("[openmeld.web.client_version_recovery_reload]", {
			reason: "vite_preload_error",
		});
		// Keep Vite's original rejection while navigation is pending. Canceling
		// the event resolves a failed import with undefined, which makes lazy
		// route components throw a second error when reading their export.
		input.reload();
	};

	input.window.addEventListener("vite:preloadError", onPreloadError);
	return () => {
		input.window.removeEventListener("vite:preloadError", onPreloadError);
	};
}
