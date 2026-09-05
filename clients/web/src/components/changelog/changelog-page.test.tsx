import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangelogPage } from "./changelog-page";

const readPageMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-start", () => ({
	useServerFn: () => readPageMock,
}));

vi.mock("#/lib/changelog/read-changelog", () => ({
	readPublishedChangelog: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: React.ComponentProps<"a"> & { to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/components/app/public-page-header", () => ({
	PublicPageHeader: () => <header data-testid="public-header" />,
}));

vi.mock("#/components/ai/message-response", () => ({
	MessageResponse: ({
		children,
		variant,
	}: {
		children: string;
		variant: string;
	}) => <div data-typeset-variant={variant}>{children}</div>,
}));

const SOURCE = {
	kind: "github" as const,
	path: "changelog/index.json",
	ref: "main",
	repository: "amplifthq/openmeld",
};

describe("ChangelogPage", () => {
	beforeEach(() => {
		readPageMock.mockReset();
	});

	it("renders published dates, release identity, outcome, and product areas", () => {
		render(
			<ChangelogPage
				initialPage={{
					entries: [
						{
							areas: ["center-agent", "channels"],
							audiences: ["members"],
							body: "Ask the Center Agent what changed.",
							evidence: ["pr:77"],
							id: "center-agent-changelog",
							kind: "new",
							publishedAt: "2026-08-18",
							release: "v0.3.61",
							title: "Understand recent OpenMeld changes",
						},
					],
					hasMore: false,
					latestPublishedAt: "2026-08-18",
					schemaVersion: 1,
					source: SOURCE,
					totalMatching: 1,
				}}
			/>
		);

		expect(screen.getByText("August 18, 2026")).toBeTruthy();
		expect(screen.getByText("Release v0.3.61")).toBeTruthy();
		expect(screen.getByText("Understand recent OpenMeld changes")).toBeTruthy();
		expect(screen.getByText("Ask the Center Agent what changed.")).toBeTruthy();
		expect(
			screen
				.getByText("Ask the Center Agent what changed.")
				.getAttribute("data-typeset-variant")
		).toBe("changelog");
		expect(screen.getByText("Center agent")).toBeTruthy();
		expect(screen.getByText("Channels")).toBeTruthy();
	});

	it("loads older entries from the next exact offset", async () => {
		readPageMock.mockResolvedValue({
			entries: [
				{
					areas: ["web"],
					audiences: ["members"],
					body: "Older but still useful.",
					evidence: ["pr:73"],
					id: "older-update",
					kind: "improved",
					publishedAt: "2026-08-17",
					title: "An older update",
				},
			],
			hasMore: false,
			latestPublishedAt: "2026-08-18",
			schemaVersion: 1,
			source: SOURCE,
			totalMatching: 2,
		});
		render(
			<ChangelogPage
				initialPage={{
					entries: [
						{
							areas: ["web"],
							audiences: ["members"],
							body: "Newest update.",
							evidence: ["pr:77"],
							id: "newest-update",
							kind: "new",
							publishedAt: "2026-08-18",
							title: "The newest update",
						},
					],
					hasMore: true,
					latestPublishedAt: "2026-08-18",
					schemaVersion: 1,
					source: SOURCE,
					totalMatching: 2,
				}}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Show older updates" }));
		expect(await screen.findByText("An older update")).toBeTruthy();
		expect(readPageMock).toHaveBeenCalledExactlyOnceWith({
			data: { limit: 10, offset: 1 },
		});
		expect(
			screen.queryByRole("button", { name: "Show older updates" })
		).toBeNull();
	});

	it("states when the canonical source is unavailable", () => {
		render(<ChangelogPage initialPage={null} />);
		expect(
			screen.getByRole("heading", {
				name: "Updates are temporarily unavailable",
			})
		).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld could not read the official Changelog. No cached or guessed updates are being shown."
			)
		).toBeTruthy();
	});
});
