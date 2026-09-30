import { afterEach, describe, expect, it, vi } from "vitest";
import { copyAppLink } from "./copy-app-link";

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), copy: vi.fn() }));
vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: mocks.bridge }));
vi.mock("#/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));

describe("copyAppLink", () => {
	afterEach(() => vi.clearAllMocks());
	it.each([
		"web",
		"desktop",
	])("copies the public destination on %s", async (client) => {
		const webOrigin = "https://openmeld.example";
		mocks.bridge.mockReturnValue(
			client === "desktop"
				? { platform: () => Promise.resolve({ webOrigin }) }
				: null
		);
		mocks.copy.mockResolvedValue(true);
		await expect(copyAppLink("/o/acme/agents?profileId=agent-1")).resolves.toBe(
			true
		);
		expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(
			new URL(
				"/o/acme/agents?profileId=agent-1",
				client === "desktop" ? webOrigin : window.location.origin
			).href
		);
	});
	it("does not claim a copy succeeded when the platform cannot resolve its public origin", async () => {
		mocks.bridge.mockReturnValue({
			platform: () => Promise.reject(new Error("Platform unavailable")),
		});
		await expect(copyAppLink("/o/acme/people")).rejects.toThrow(
			"Platform unavailable"
		);
		expect(mocks.copy).not.toHaveBeenCalled();
	});
});
