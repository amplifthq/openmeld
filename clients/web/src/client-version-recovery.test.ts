import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
	CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS,
	installClientVersionRecovery,
} from "./client-version-recovery";

const INCIDENT_STARTED_AT_MS = 1_000_000;

describe("client version recovery", () => {
	let dispose: (() => void) | undefined;

	beforeEach(() => {
		window.sessionStorage.clear();
	});

	afterEach(() => {
		dispose?.();
		dispose = undefined;
		window.sessionStorage.clear();
	});

	it("reloads once when Vite reports that a deployed chunk is no longer available", () => {
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () => INCIDENT_STARTED_AT_MS,
			reload,
			window,
		});
		const preloadError = new Event("vite:preloadError", {
			cancelable: true,
		});

		window.dispatchEvent(preloadError);

		// Vite must still reject the import while the document reload is pending.
		// Canceling the event resolves the failed import with undefined instead.
		expect(preloadError.defaultPrevented).toBe(false);
		expect(reload).toHaveBeenCalledOnce();
		expect(
			window.sessionStorage.getItem(CLIENT_VERSION_RECOVERY_ATTEMPT_KEY)
		).toBe(String(INCIDENT_STARTED_AT_MS));
	});

	it("does not enter a reload loop when the replacement page also loses a chunk", () => {
		window.sessionStorage.setItem(
			CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
			String(INCIDENT_STARTED_AT_MS)
		);
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () =>
				INCIDENT_STARTED_AT_MS + CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS - 1,
			reload,
			window,
		});
		const repeatedPreloadError = new Event("vite:preloadError", {
			cancelable: true,
		});

		window.dispatchEvent(repeatedPreloadError);

		expect(repeatedPreloadError.defaultPrevented).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});
});
