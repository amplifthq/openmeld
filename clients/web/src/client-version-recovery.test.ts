import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CLIENT_VERSION_RECOVERY_ATTEMPT_KEY,
	CLIENT_VERSION_RECOVERY_RETRY_WINDOW_MS,
	installClientVersionRecovery,
	registerClientVersionRecoveryBlocker,
} from "./client-version-recovery";
import {
	completeSpaceSend,
	markSpaceSendPending,
} from "./components/spaces/space-pending-send";

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

	it.each([
		"Failed to fetch dynamically imported module: /assets/old.js",
		"error loading dynamically imported module: /assets/old.js",
		"Importing a module script failed.",
		"Unable to preload CSS for /assets/old.css",
	])("reloads once and preserves the original import rejection: %s", (message) => {
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () => INCIDENT_STARTED_AT_MS,
			reload,
			window,
		});
		const preloadError = new Event("vite:preloadError", {
			cancelable: true,
		});
		Object.assign(preloadError, {
			payload: new Error(message),
		});

		window.dispatchEvent(preloadError);

		// Vite must still reject the import while the document reload is pending.
		// Canceling the event resolves the failed import with undefined instead.
		expect(preloadError.defaultPrevented).toBe(false);
		expect(reload).toHaveBeenCalledOnce();
		expect(
			window.sessionStorage.getItem(CLIENT_VERSION_RECOVERY_ATTEMPT_KEY)
		).toBe(String(INCIDENT_STARTED_AT_MS));
		window.dispatchEvent(preloadError);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("does not reload for application exceptions thrown while importing a module", () => {
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () => INCIDENT_STARTED_AT_MS,
			reload,
			window,
		});
		const event = Object.assign(
			new Event("vite:preloadError", { cancelable: true }),
			{ payload: new Error("resolveServiceAction is not defined") }
		);
		window.dispatchEvent(event);
		expect(reload).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		expect(
			window.sessionStorage.getItem(CLIENT_VERSION_RECOVERY_ATTEMPT_KEY)
		).toBeNull();
	});

	it("leaves unsaved work and its navigation guards mounted until the owner allows recovery", () => {
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () => INCIDENT_STARTED_AT_MS,
			reload,
			window,
		});
		let blocked = true;
		const removeBlocker = registerClientVersionRecoveryBlocker(() => blocked);
		const event = Object.assign(
			new Event("vite:preloadError", { cancelable: true }),
			{ payload: new Error("Unable to preload CSS for /assets/old.css") }
		);
		try {
			window.dispatchEvent(event);
			expect(reload).not.toHaveBeenCalled();
			expect(
				window.sessionStorage.getItem(CLIENT_VERSION_RECOVERY_ATTEMPT_KEY)
			).toBeNull();
			blocked = false;
			window.dispatchEvent(event);
			expect(reload).toHaveBeenCalledOnce();
		} finally {
			removeBlocker();
		}
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
		Object.assign(repeatedPreloadError, {
			payload: new Error(
				"Failed to fetch dynamically imported module: /assets/old.js"
			),
		});

		window.dispatchEvent(repeatedPreloadError);

		expect(repeatedPreloadError.defaultPrevented).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it("defers automatic refresh until pending Space sends finish", () => {
		const reload = vi.fn();
		dispose = installClientVersionRecovery({
			now: () => INCIDENT_STARTED_AT_MS,
			reload,
			window,
		});
		markSpaceSendPending("recovery-test", vi.fn());
		const event = Object.assign(
			new Event("vite:preloadError", { cancelable: true }),
			{ payload: new Error("Unable to preload CSS for /assets/old.css") }
		);
		try {
			window.dispatchEvent(event);
			expect(reload).not.toHaveBeenCalled();
		} finally {
			completeSpaceSend("recovery-test");
		}
		window.dispatchEvent(event);
		expect(reload).toHaveBeenCalledOnce();
	});
});
