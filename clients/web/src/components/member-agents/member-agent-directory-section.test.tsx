import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberAgentDirectorySection } from "./member-agent-directory-section";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children: ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

describe("MemberAgent empty state", () => {
	it("offers Connect computer first and Create Agent second", () => {
		const onCreateAgent = vi.fn();
		render(
			<MemberAgentDirectorySection
				directory={{ rows: [], unassigned: [] }}
				emptyActions={{
					connectComputerPath: "/o/acme/connect",
					onCreateAgent,
				}}
				label="Your Agents"
				onOpenMemberAgent={vi.fn()}
				renderUnassignedCard={() => null}
			/>
		);
		const connect = screen.getByRole("link", { name: "Connect computer" });
		const create = screen.getByRole("button", { name: "Create Agent" });
		expect(connect.getAttribute("href")).toBe("/o/acme/connect");
		// Connect computer is the primary action and comes first.
		expect(
			[...document.querySelectorAll("a, button")].map(
				(element) => element.textContent
			)
		).toEqual(["Connect computer", "Create Agent"]);
		expect(create.className).toContain("bg-secondary");
		expect(connect.className).not.toContain("bg-secondary");
		fireEvent.click(create);
		expect(onCreateAgent).toHaveBeenCalledTimes(1);
	});

	it("leaves out Create Agent when the viewer cannot create one", () => {
		render(
			<MemberAgentDirectorySection
				directory={{ rows: [], unassigned: [] }}
				emptyActions={{ connectComputerPath: "/o/acme/connect" }}
				label="Your Agents"
				onOpenMemberAgent={vi.fn()}
				renderUnassignedCard={() => null}
			/>
		);
		expect(screen.getByRole("link", { name: "Connect computer" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
	});
});
