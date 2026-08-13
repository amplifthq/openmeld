import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_AGENT_INSTALL_GUIDES } from "#/lib/local-agent-install-guides";
import {
	LocalAgentInstallGuideDetailPage,
	LocalAgentInstallGuideIndexPage,
} from "./local-agent-install-guide-pages";

const useNavigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => useNavigateMock,
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: "/guides/local-agents" } }),
}));

describe("LocalAgentInstallGuideIndexPage", () => {
	afterEach(() => {
		cleanup();
		useNavigateMock.mockReset();
	});

	it("lists only active supported local agents", () => {
		render(<LocalAgentInstallGuideIndexPage />);

		expect(
			screen.getByRole("heading", { name: "Install a local agent CLI" })
		).toBeTruthy();
		expect(screen.getByText("Codex CLI")).toBeTruthy();
		expect(screen.getByText("Claude Code")).toBeTruthy();
		expect(screen.getByText("Cursor CLI")).toBeTruthy();
		expect(screen.getByText("Grok Build")).toBeTruthy();
		expect(screen.getByText("OpenCode")).toBeTruthy();
		expect(screen.queryByText("OpenClaw")).toBeNull();
		const guideGrid = screen.getByTestId("local-agent-guide-grid");
		expect(guideGrid.className).toContain("xl:grid-cols-5");
		const guideCards = [...guideGrid.querySelectorAll("a.rounded-md")];
		expect(guideCards).toHaveLength(5);
		expect(guideCards.map((card) => card.textContent)).toEqual([
			expect.stringContaining("Codex CLI"),
			expect.stringContaining("Claude Code"),
			expect.stringContaining("Grok Build"),
			expect.stringContaining("Cursor CLI"),
			expect.stringContaining("OpenCode"),
		]);
		expect(
			guideGrid.querySelector('[data-testid="local-agent-logo-grok-build"]')
		).toBeTruthy();
	});

	it("links users back to the setup surface", () => {
		render(<LocalAgentInstallGuideIndexPage />);

		expect(
			screen.getByRole("link", { name: "Open settings" }).getAttribute("href")
		).toBe("/login");
		expect(
			screen.getByText("Already installed one? Re-run your setup command", {
				exact: false,
			})
		).toBeTruthy();
	});
});

describe("LocalAgentInstallGuideDetailPage", () => {
	afterEach(() => {
		cleanup();
		useNavigateMock.mockReset();
	});

	it("shows the official install link and detection warning", () => {
		render(
			<LocalAgentInstallGuideDetailPage
				guide={LOCAL_AGENT_INSTALL_GUIDES.codex}
			/>
		);

		const installLink = screen.getByRole("link", {
			name: "Open official install guide",
		});
		expect(installLink.getAttribute("href")).toBe(
			"https://developers.openai.com/codex/cli"
		);
		expect(installLink.getAttribute("target")).toBe("_blank");
		expect(installLink.getAttribute("rel")).toBe("noopener");
		expect(
			screen.getByText("OpenMeld detects runnable local agent CLIs", {
				exact: false,
			})
		).toBeTruthy();
		expect(screen.getByText("codex --version")).toBeTruthy();
		const detailGrid = screen.getByTestId("local-agent-detail-grid");
		expect(detailGrid.className).toContain("md:grid-cols-2");
		expect(detailGrid.querySelectorAll("section.rounded-md")).toHaveLength(3);
	});
});
