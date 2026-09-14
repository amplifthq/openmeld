import { describe, expect, it } from "vitest";
import { formatDesktopError } from "./desktop-error";

describe("Desktop sign-in errors", () => {
	it.each([
		"Could not connect to OpenMeld. Check your connection and try again.",
		"This sign-in could not be completed. Sign in with your browser again.",
		"This version of OpenMeld Desktop is not supported by the server. Check for an app update.",
		"Desktop sign-in changed. Check the account and try again.",
		"This CLI and Service do not support this action. Update OpenMeld through Web and check again.",
		"Check your Desktop sign-in before controlling this Service.",
		"A Service action is still in progress. Check its status before trying again.",
		"A computer connection is already in progress.",
		"OpenMeld Tools could not be downloaded. Check your connection and try again.",
	])("preserves the known recovery instruction without IPC details: %s", (message) => {
		expect(
			formatDesktopError(
				new Error(
					`Error invoking remote method 'desktop:session': Error: ${message}`
				),
				"Try again."
			)
		).toBe(message);
	});
	it.each([
		new Error("SDK failure token=private"),
		new Error(
			"Desktop sign-in changed. Check the account and try again. token=private"
		),
		new Error("Network unknown"),
		null,
	])("keeps unknown failures out of user copy", (error) => {
		expect(
			formatDesktopError(
				error,
				"Could not open your workspace. Try signing in again."
			)
		).toBe("Could not open your workspace. Try signing in again.");
	});
});
