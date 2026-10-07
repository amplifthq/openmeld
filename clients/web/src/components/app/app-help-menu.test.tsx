import { changelogIndexSchema } from "@openmeld/schemas";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import publishedIndex from "../../../../../changelog/index.json";
import { AppHelpMenu } from "./app-help-menu";

const readLatestChangelogMock = vi.hoisted(() => vi.fn());
vi.mock("#/lib/changelog/read-latest-changelog", () => ({
	readLatestChangelog: readLatestChangelogMock,
}));
afterEach(cleanup);

it("opens the latest three published updates and preserves official external links", async () => {
	const entries = changelogIndexSchema
		.parse(publishedIndex)
		.entries.slice(0, 3);
	readLatestChangelogMock.mockResolvedValueOnce(entries);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>Account</DropdownMenuTrigger>
				<FluidDropdownMenuContent>
					<AppHelpMenu index={0} />
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</QueryClientProvider>
	);
	fireEvent.keyDown(screen.getByRole("menuitem", { name: "Help" }), {
		key: "ArrowRight",
	});
	for (const entry of entries) {
		const link = await screen.findByRole("menuitem", {
			name: new RegExp(entry.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		});
		expect(link.getAttribute("href")).toBe(
			`https://openmeld.ai/changelog#update-${entry.id}`
		);
		expect(link.querySelector("time")?.getAttribute("datetime")).toBe(
			entry.publishedAt
		);
	}
	expect(document.querySelectorAll("time")).toHaveLength(3);
	expect(readLatestChangelogMock).toHaveBeenCalledTimes(1);
	for (const [name, href] of [
		["Full changelog", "https://openmeld.ai/changelog"],
		["OpenMeld website", "https://openmeld.ai"],
		["Documentation", "https://docs.openmeld.ai"],
	]) {
		const link = screen.getByRole("menuitem", { name });
		expect(link.getAttribute("href")).toBe(href);
		expect(link.getAttribute("target")).toBe("_blank");
	}
	client.clear();
});
