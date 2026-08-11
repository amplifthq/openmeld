import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAgentsGuideRoute } from "./local-agents";

const pathnameMock = vi.hoisted(() => vi.fn());
const useNavigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: {
		children: ReactNode;
		params?: { agentId?: string };
		to: string;
	}) => {
		const href = params?.agentId ? to.replace("$agentId", params.agentId) : to;
		return (
			<a href={href} {...props}>
				{children}
			</a>
		);
	},
	Outlet: () => <div data-testid="local-agent-guide-outlet" />,
	createFileRoute: () => (options: unknown) => options,
	useNavigate: () => useNavigateMock,
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: pathnameMock() } }),
}));

describe("LocalAgentsGuideRoute", () => {
	beforeEach(() => {
		pathnameMock.mockReset().mockReturnValue("/guides/local-agents");
		useNavigateMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders the install guide index on the guide root path", () => {
		render(<LocalAgentsGuideRoute />);

		expect(
			screen.getByRole("heading", { name: "Install a local agent CLI" })
		).toBeTruthy();
		expect(screen.queryByTestId("local-agent-guide-outlet")).toBeNull();
	});

	it("renders the child route outlet on agent detail paths", () => {
		pathnameMock.mockReturnValue("/guides/local-agents/codex");

		render(<LocalAgentsGuideRoute />);

		expect(screen.getByTestId("local-agent-guide-outlet")).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Install a local agent CLI" })
		).toBeNull();
	});
});
