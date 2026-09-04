import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	DirectoryAgentProfileSummary,
	DirectoryHumanProfileComputer,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryAgentProfilesSummary,
	DirectoryHumanProfileComputerSummary,
} from "#/components/directory/directory-human-profile-presentation";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("directory Human Profile presentation", () => {
	afterEach(cleanup);

	it("keeps the five most relevant Agents in one horizontal popover row", () => {
		const profiles = Array.from({ length: 7 }, (_, index) =>
			buildAgentProfile(index + 1)
		);

		const { container } = render(
			<DirectoryAgentProfilesSummary
				modelCatalog={null}
				ownerName="Monica Cheng"
				path="/o/acme/people?profileId=human-monica"
				profiles={profiles}
				variant="popover"
			/>
		);

		const heading = screen.getByRole("heading", { name: "Agents" });
		expect(screen.getByText("5 of 7")).toBeTruthy();
		const list = screen.getByRole("list", { name: "Monica Cheng's Agents" });
		expect(list.className).toContain("overflow-x-auto");
		expect(screen.getByRole("link", { name: "Open Agent 1" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open Agent 5" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Open Agent 6" })).toBeNull();
		const viewAllLink = screen.getByRole("link", {
			name: "View all of Monica Cheng's Agents",
		});
		expect(viewAllLink.getAttribute("href")).toBe(
			"/o/acme/people?profileId=human-monica"
		);
		expect(viewAllLink.textContent).toBe("View all");
		expect(viewAllLink.parentElement).toBe(
			heading.parentElement?.parentElement
		);
		expect(container.querySelector("section")?.children).toHaveLength(2);
	});

	it("omits the entire Agents section from a popover when there are no Agents", () => {
		const { container } = render(
			<DirectoryAgentProfilesSummary
				modelCatalog={null}
				ownerName="Carol Chen"
				path="/o/acme/people?profileId=human-carol"
				profiles={[]}
				variant="popover"
			/>
		);

		expect(container.childElementCount).toBe(0);
		expect(screen.queryByText("No Agents yet")).toBeNull();
	});

	it("uses the shared computer summary and its canonical route", () => {
		const computer: DirectoryHumanProfileComputer = {
			count: 1,
			label: "Computer connected",
			path: "/o/acme/computers/computer-1",
			state: "connected",
		};

		render(
			<DirectoryHumanProfileComputerSummary
				computer={computer}
				ownerName="Monica Cheng"
			/>
		);

		expect(
			screen
				.getByRole("link", { name: "Monica Cheng: Computer connected" })
				.getAttribute("href")
		).toBe("/o/acme/computers/computer-1");
	});
});

function buildAgentProfile(index: number): DirectoryAgentProfileSummary {
	return {
		agentControllerRef: "builtin:codex",
		avatarImageUrl: null,
		id: `agent-${index}`,
		modelSelection: null,
		modelSelectionIsKnown: false,
		name: `Agent ${index}`,
		path: `/o/acme/agents?profileId=agent-${index}`,
	};
}
