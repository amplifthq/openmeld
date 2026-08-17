import { beforeEach, describe, expect, it, vi } from "vitest";

const readPublishedChangelogMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));

vi.mock("#/components/changelog/changelog-page", () => ({
	ChangelogPage: vi.fn(),
}));

vi.mock("#/lib/changelog/read-changelog", () => ({
	readPublishedChangelog: readPublishedChangelogMock,
}));

import { loadChangelogPage } from "./changelog";

const RESPONSE = {
	entries: [],
	hasMore: false,
	latestPublishedAt: null,
	schemaVersion: 1,
	source: {
		kind: "github",
		path: "changelog/index.json",
		ref: "main",
		repository: "amplifthq/openmeld",
	},
	totalMatching: 0,
};

describe("Changelog route loader", () => {
	beforeEach(() => {
		readPublishedChangelogMock.mockReset();
	});

	it("loads the newest published entries through the server boundary", async () => {
		readPublishedChangelogMock.mockResolvedValue(RESPONSE);

		await expect(loadChangelogPage()).resolves.toEqual({
			initialPage: RESPONSE,
		});
		expect(readPublishedChangelogMock).toHaveBeenCalledExactlyOnceWith({
			data: { limit: 10 },
		});
	});

	it("renders an honest unavailable state instead of stale or guessed data", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		readPublishedChangelogMock.mockRejectedValue(new Error("source offline"));

		await expect(loadChangelogPage()).resolves.toEqual({ initialPage: null });
		expect(consoleError).toHaveBeenCalledWith(
			"[web.changelog.initial_read_failed]",
			{ error: "source offline" }
		);
		consoleError.mockRestore();
	});
});
