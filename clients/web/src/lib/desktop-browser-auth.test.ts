import { expect, it } from "vitest";
import { resolveDesktopBrowserIdentity } from "./desktop-browser-auth";

it("selects a callback only from the configured backend identity", () => {
	expect(
		resolveDesktopBrowserIdentity({
			webOrigin: "https://openmeld.ai",
			clientId: "openmeld-desktop",
		}).authScheme
	).toBe("sh.openmeld.desktop");
	expect(
		resolveDesktopBrowserIdentity({
			webOrigin: "http://test.localhost:3000",
			developmentTarget: "disposable",
			clientId: "openmeld-desktop-test",
		}).authScheme
	).toBe("sh.openmeld.desktop.test");
	expect(
		resolveDesktopBrowserIdentity({
			webOrigin: "http://test.localhost:3000",
			clientId: "electron",
		}).authScheme
	).toBe("sh.openmeld.desktop.dev");
	expect(() =>
		resolveDesktopBrowserIdentity({
			webOrigin: "https://openmeld.ai",
			developmentTarget: "disposable",
			clientId: "openmeld-desktop-test",
		})
	).toThrow("not allowed in production");
	for (const clientId of [
		"electron",
		"openmeld-desktop-test",
		"https://other.invalid",
	]) {
		expect(() =>
			resolveDesktopBrowserIdentity({
				webOrigin: "https://openmeld.ai",
				clientId,
			})
		).toThrow("different Desktop app");
	}
});
