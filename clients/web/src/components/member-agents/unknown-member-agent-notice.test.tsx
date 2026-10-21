import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { UnknownMemberAgentNotice } from "./member-agent-detail";

vi.mock("@tanstack/react-router", () => ({
	Link: (props: { children: ReactNode; to: string; className?: string }) => (
		<a className={props.className} href={props.to}>
			{props.children}
		</a>
	),
}));

afterEach(cleanup);

it("offers a local way back from an unknown MemberAgent (R4-05)", () => {
	render(<UnknownMemberAgentNotice agentsPath="/o/acme/agents" />);
	expect(
		screen.getByText("This Agent isn’t available in this Organization.")
	).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Back to Agents" }).getAttribute("href")
	).toBe("/o/acme/agents");
});
