import type { OpenMeldLogoStrongProps } from "@openmeld/ui/components/openmeld-logo-strong";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { LandingPage } from "./landing-page";

const GOOGLE_WORKSPACE_APP_USE_TEXT_PATTERN =
	/When you connect Gmail, Google Calendar, or Google Drive, OpenMeld requests read-only access/i;
const GOOGLE_WORKSPACE_WRITE_CLAIM_PATTERN = /drafting or sending a message/i;
const useNavigateMock = vi.hoisted(() => vi.fn());
const openMeldLogoStrongMock = vi.hoisted(() =>
	vi.fn(
		({
			className,
			colors,
			lightAppearance,
			scale,
			size,
		}: OpenMeldLogoStrongProps) => (
			<img
				alt="OpenMeld logo"
				data-class-name={className}
				data-colors={colors ? "custom" : "default"}
				data-light-fill-min-opacity={lightAppearance?.fillMinOpacity}
				data-light-glow-max-opacity={lightAppearance?.glowMaxOpacity}
				data-light-stroke-opacity={lightAppearance?.strokeOpacity}
				data-scale={scale}
				data-size={size}
				height={1}
				src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
				width={1}
			/>
		)
	)
);

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => useNavigateMock,
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: "/" } }),
}));

vi.mock("@openmeld/ui/components/openmeld-logo-strong", () => ({
	OpenMeldLogoStrong: openMeldLogoStrongMock,
}));

class TestIntersectionObserver implements IntersectionObserver {
	readonly root = null;
	readonly rootMargin = "";
	readonly thresholds = [0];

	disconnect() {
		return;
	}
	observe() {
		return;
	}
	takeRecords() {
		return [];
	}
	unobserve() {
		return;
	}
}

describe("LandingPage", () => {
	beforeAll(() => {
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});

	afterAll(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		cleanup();
		useNavigateMock.mockReset();
		openMeldLogoStrongMock.mockClear();
	});

	it("uses the correct public or authenticated entry path", () => {
		const { rerender } = render(<LandingPage authenticatedEntryPath={null} />);

		const header = screen.getByRole("banner");
		expect(header).toBeTruthy();
		expect(
			within(header).getByRole("img", { name: "OpenMeld" }).className
		).toContain("font-geist-pixel-square");
		expect(within(header).getByText("Experimental")).toBeTruthy();
		expect(
			within(header).getByRole("link", { name: "Go to OpenMeld homepage" })
				.className
		).toContain("[&_span]:!text-foreground");
		expect(header.className).toContain("!bg-transparent");
		expect(header.className).toContain("!backdrop-blur-none");
		expect(header.className).toContain("!border-0");
		expect(header.className).not.toContain("bg-background/60");
		expect(header.className).not.toContain("backdrop-blur-xl");
		expect(
			within(header).getByRole("link", { name: "Go to OpenMeld homepage" })
				.className
		).toContain("backdrop-blur-md");
		const loginLink = screen.getByRole("link", { name: "Login" });
		expect(loginLink.getAttribute("href")).toBe("/login");
		expect(loginLink.className).toContain("rounded-md");
		expect(loginLink.className).toContain("!bg-background/78");
		expect(loginLink.className).toContain("backdrop-blur-md");
		expect(loginLink.className).toContain("!border-foreground/30");
		expect(loginLink.className).not.toContain("!border-0");
		expect(loginLink.className).toContain("!text-foreground");
		expect(
			screen
				.getByRole("link", { name: "Start with your Center Agent" })
				.getAttribute("href")
		).toBe("/login");
		const addToSlackLink = screen.getByRole("link", { name: "Add to Slack" });
		expect(addToSlackLink.getAttribute("href")).toBe("/add-to-slack");
		expect(addToSlackLink.className).toContain("rounded-md");
		expect(within(addToSlackLink).getByTestId("slack-mark-icon")).toBeTruthy();

		rerender(<LandingPage authenticatedEntryPath="/o/acme" />);

		expect(
			screen.getByRole("link", { name: "Enter" }).getAttribute("href")
		).toBe("/o/acme");
		expect(
			screen
				.getByRole("link", { name: "Start with your Center Agent" })
				.getAttribute("href")
		).toBe("/o/acme");
		expect(
			screen.getByRole("link", { name: "Add to Slack" }).getAttribute("href")
		).toBe("/add-to-slack");
		expect(
			screen
				.getByRole("link", { name: "Open your Center Agent" })
				.getAttribute("href")
		).toBe("/o/acme");
		expect(
			screen
				.getByRole("link", { name: "Add Center Agent to Slack" })
				.getAttribute("href")
		).toBe("/add-to-slack");
	});

	it("keeps the first screen concise and removes the old chat demo", () => {
		const { container } = render(<LandingPage authenticatedEntryPath={null} />);

		const hero = screen.getByTestId("landing-hero-section");
		const logo = within(hero).getByRole("img", { name: "OpenMeld logo" });
		const heading = within(hero).getByRole("heading", {
			level: 1,
			name: "Open-source operating system for agent-native teams of people and machines.",
		});
		const tagline = within(hero).getByTestId("landing-hero-tagline");
		const summary = within(hero).getByTestId("landing-hero-summary");

		expect(logo.getAttribute("data-size")).toBe(
			"clamp(0.29rem,0.65vw,0.52rem)"
		);
		expect(logo.getAttribute("data-class-name")).toContain("text-foreground");
		expect(logo.getAttribute("data-light-fill-min-opacity")).toBe("0.44");
		expect(logo.getAttribute("data-light-glow-max-opacity")).toBe("0.32");
		expect(logo.getAttribute("data-light-stroke-opacity")).toBe("0.28");
		expect(heading.className).toContain("font-geist-pixel-square");
		expect(heading.className).toContain("landing-display-tight");
		expect(tagline.textContent).toBe(
			"People and agents, working as one—learning and evolving together."
		);
		expect(summary.className).toContain("lg:col-span-4");
		expect(summary.className).toContain("lg:col-start-9");
		const summarySentences = within(hero).getAllByTestId(
			"landing-hero-summary-sentence"
		);
		expect(summarySentences).toHaveLength(3);
		for (const sentence of summarySentences) {
			expect(sentence.className).toContain("block");
		}
		expect(summarySentences[0]?.textContent).toContain(
			"Add the Center Agent to"
		);
		expect(summarySentences[1]?.textContent).toContain(
			"It connects the right local agents"
		);
		expect(summarySentences[1]?.textContent).toContain(
			"from your team and puts them to work."
		);
		expect(summarySentences[2]?.textContent).toContain(
			"They learn from your team’s shared memory and context, wherever it lives."
		);
		expect(within(hero).getByTestId("channel-logo-slack")).toBeTruthy();
		expect(
			within(hero).getByTestId("local-agent-logo-claude-code")
		).toBeTruthy();
		expect(within(hero).getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(within(hero).getByTestId("local-agent-logo-cursor")).toBeTruthy();
		expect(
			within(hero).getByTestId("local-agent-logo-grok-build")
		).toBeTruthy();
		expect(within(hero).getByTestId("local-agent-logo-opencode")).toBeTruthy();
		const heroLocalAgentLogos = [
			"codex",
			"claude-code",
			"grok-build",
			"opencode",
			"cursor",
		].map((agentId) => within(hero).getByTestId(`local-agent-logo-${agentId}`));
		for (const [index, logoElement] of heroLocalAgentLogos.entries()) {
			const nextLogoElement = heroLocalAgentLogos[index + 1];
			if (nextLogoElement) {
				expect(logoElement.compareDocumentPosition(nextLogoElement)).toBe(
					Node.DOCUMENT_POSITION_FOLLOWING
				);
			}
		}
		expect(
			within(hero).queryByText(
				"I found this request in Slack #release: can someone prep a release-risk pass before we ship?"
			)
		).toBeNull();
		expect(within(hero).queryByText("Slack to local Codex")).toBeNull();

		const shader = within(hero).getByTestId("landing-hero-shader");
		const shaderFilter = within(hero).getByTestId("landing-hero-shader-filter");
		const contentGrid = within(hero).getByTestId("landing-hero-content-grid");
		expect(shader.className).toContain("mix-blend-multiply");
		expect(shader.className).toContain("dark:mix-blend-screen");
		expect(shader.parentElement).toBe(hero);
		expect(shaderFilter.parentElement).toBe(hero);
		expect(contentGrid.contains(shader)).toBe(false);
		expect(shaderFilter.getAttribute("style")).toContain("var(--background)");

		const displayHeadings = container.querySelectorAll(
			"h1.font-geist-pixel-square, h2.font-geist-pixel-square"
		);
		expect(displayHeadings.length).toBeGreaterThan(5);
		for (const displayHeading of displayHeadings) {
			expect(displayHeading.className).toContain("landing-display-tight");
		}
	});

	it("moves from the Center Agent promise into the existing Space demo", () => {
		render(<LandingPage authenticatedEntryPath={null} />);

		const centerAgentHeading = screen.getByRole("heading", {
			name: "One request can put the whole team in motion.",
		});
		const spaceHeading = screen.getByRole("heading", {
			name: "Every request becomes a shared work loop.",
		});
		const spacesSection = screen.getByText("Spaces").closest("section");

		expect(centerAgentHeading.compareDocumentPosition(spaceHeading)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		const centerAgentVisual = screen.getByTestId("landing-center-agent-visual");
		expect(centerAgentVisual).toBeTruthy();
		expect(
			centerAgentVisual.querySelector('path[d="M612 40H626V218H148"]')
		).toBeTruthy();
		const resultReturnLabel = within(centerAgentVisual).getByText(
			"Every result returns"
		);
		expect(resultReturnLabel.getAttribute("dominant-baseline")).toBe("middle");
		expect(resultReturnLabel.getAttribute("y")).toBe("218");
		expect(
			centerAgentVisual.querySelector('path[d="M554 62V218H104"]')
		).toBeNull();
		expect(spacesSection).toBeTruthy();
		expect(
			within(spacesSection as HTMLElement)
				.getByTestId("landing-space-demo-grid")
				.getAttribute("style")
		).toContain("7.5%");
		expect(
			within(spacesSection as HTMLElement).getByText("Production release Space")
		).toBeTruthy();
		expect(
			within(spacesSection as HTMLElement).getByText(
				"One request to five agents"
			)
		).toBeTruthy();
		expect(
			within(spacesSection as HTMLElement).getAllByText("Grok Build").length
		).toBeGreaterThan(0);
		expect(
			within(spacesSection as HTMLElement).getAllByTestId(
				"local-agent-logo-grok-build"
			).length
		).toBeGreaterThan(0);
		expect(
			within(spacesSection as HTMLElement).getByText(
				"Can we ship the billing meter rewrite today? I need a release call, risk check, and validation plan."
			)
		).toBeTruthy();
		expect(
			within(spacesSection as HTMLElement).getByText("Built around the goal.")
		).toBeTruthy();
		expect(
			within(spacesSection as HTMLElement).getByText("One brief, many agents.")
		).toBeTruthy();
	});

	it("explains the expanded collaboration system and the complete visible loop", () => {
		render(<LandingPage authenticatedEntryPath={null} />);

		const localExecutionHeading = screen.getByRole("heading", {
			name: "Your agents stay local. Their work stays connected.",
		});
		const localExecutionSection = localExecutionHeading.closest("section");

		expect(localExecutionSection).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"local-agent-logo-codex"
			)
		).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"local-agent-logo-claude-code"
			)
		).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"local-agent-logo-opencode"
			)
		).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"local-agent-logo-cursor"
			)
		).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"local-agent-logo-grok-build"
			)
		).toBeTruthy();
		const localExecutionLogos = [
			"codex",
			"claude-code",
			"grok-build",
			"opencode",
			"cursor",
		].map((agentId) =>
			within(localExecutionSection as HTMLElement).getByTestId(
				`local-agent-logo-${agentId}`
			)
		);
		for (const [index, logoElement] of localExecutionLogos.entries()) {
			const nextLogoElement = localExecutionLogos[index + 1];
			if (nextLogoElement) {
				expect(logoElement.compareDocumentPosition(nextLogoElement)).toBe(
					Node.DOCUMENT_POSITION_FOLLOWING
				);
			}
		}
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"landing-local-workspace-visual"
			)
		).toBeTruthy();
		expect(
			within(localExecutionSection as HTMLElement).getByTestId(
				"landing-bar-wave"
			)
		).toBeTruthy();
		const wakeTargetVisual = within(
			localExecutionSection as HTMLElement
		).getByTestId("landing-wake-target-visual");
		expect(wakeTargetVisual).toBeTruthy();
		expect(
			wakeTargetVisual.querySelector('path[d="M84 52H116V88H146"]')
		).toBeTruthy();
		expect(
			wakeTargetVisual.querySelector('path[d="M214 105H279"]')
		).toBeTruthy();
		expect(screen.getByText("npx openmeld")).toBeTruthy();
		expect(screen.getByRole("link", { name: "NPM" }).getAttribute("href")).toBe(
			"https://www.npmjs.com/package/openmeld"
		);
		expect(
			screen.getByRole("heading", {
				name: "Context should get richer every time your team works.",
			})
		).toBeTruthy();
		const contextStack = screen.getByTestId("landing-context-stack");
		expect(contextStack).toBeTruthy();
		expect(
			contextStack.querySelector(
				'polygon[points="20,224 340,118 760,204 440,310"]'
			)
		).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				name: "See the work. Skip the surveillance.",
			})
		).toBeTruthy();
		expect(screen.getByTestId("landing-agent-activity-canvas")).toBeTruthy();
		expect(screen.getByTestId("landing-agent-activity-lanes")).toBeTruthy();
		expect(
			within(screen.getByTestId("landing-agent-activity-lanes")).getAllByText(
				"Cursor"
			)
		).toHaveLength(2);
		const activityLaneStack = screen.getByTestId(
			"landing-agent-activity-lane-stack"
		);
		expect(activityLaneStack.className).not.toContain("divide-y");
		expect(activityLaneStack.className).not.toContain("border-y");
		expect(screen.queryByText("Activity, without private content")).toBeNull();
		const connectedWorkSection = screen.getByTestId(
			"landing-connected-work-section"
		);
		expect(
			within(connectedWorkSection).getByRole("heading", {
				name: "Bring work in from Slack or Lark. Connect your Center Agent to 12 Apps.",
			})
		).toBeTruthy();
		expect(
			within(connectedWorkSection).getByRole("heading", {
				name: "2 Channels",
			})
		).toBeTruthy();
		expect(
			within(connectedWorkSection).getByRole("heading", {
				name: "12 Apps",
			})
		).toBeTruthy();
		expect(
			within(connectedWorkSection).getByText(
				GOOGLE_WORKSPACE_APP_USE_TEXT_PATTERN
			)
		).toBeTruthy();
		expect(
			within(connectedWorkSection).queryByText(
				GOOGLE_WORKSPACE_WRITE_CLAIM_PATTERN
			)
		).toBeNull();
		const availableChannels = within(connectedWorkSection).getByRole("list", {
			name: "Available Channels",
		});
		expect(within(availableChannels).getAllByRole("listitem")).toHaveLength(2);
		expect(within(availableChannels).getByText("Slack")).toBeTruthy();
		expect(within(availableChannels).getByText("Lark")).toBeTruthy();
		const larkLogoContainer =
			within(availableChannels).getByTestId("app-logo-lark").parentElement;
		expect(larkLogoContainer?.className).toContain("dark:bg-transparent");
		expect(larkLogoContainer?.className).toContain("dark:border-0");
		expect(larkLogoContainer?.className).toContain("dark:shadow-none");
		expect(larkLogoContainer?.className).not.toContain("dark:bg-muted/50");
		const availableApps = within(connectedWorkSection).getByRole("list", {
			name: "Available Apps",
		});
		expect(within(availableApps).getAllByRole("listitem")).toHaveLength(12);
		for (const appName of [
			"GitHub",
			"Google Drive",
			"Google Calendar",
			"Gmail",
			"Notion",
			"Linear",
			"PostHog",
			"Figma",
			"Cloudflare Workers",
			"Cloudflare R2",
			"Cloudflare DNS",
			"Cloudflare Browser Rendering",
		]) {
			expect(within(availableApps).getByText(appName)).toBeTruthy();
		}
		expect(
			within(connectedWorkSection).getByTestId("landing-routines-icon")
		).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				name: "One system, from request to result.",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Install" }).getAttribute("href")
		).toBe("/guides/local-agents");
		expect(
			screen.getByRole("heading", {
				name: "A result. A handoff. Or a clear failure. Never silence.",
			})
		).toBeTruthy();
	});

	it("uses a minimal FAQ and a reveal-style footer", () => {
		const { container } = render(<LandingPage authenticatedEntryPath={null} />);

		const localQuestion = screen.getByRole("button", {
			name: "Which agents run locally, and which run in OpenMeld?",
		});
		fireEvent.click(localQuestion);
		expect(
			screen.getByText(
				"The Center Agent is OpenMeld’s hosted organization coordinator, so it can answer even when your laptop is closed. Codex, Claude Code, Grok Build, Cursor, and OpenCode keep running on your team’s own computers through OpenMeld Service."
			)
		).toBeTruthy();

		const integrationsQuestion = screen.getByRole("button", {
			name: "How do Channels and Apps differ?",
		});
		fireEvent.click(integrationsQuestion);
		expect(
			screen.getByText(
				"Slack and Lark are Channels where people can message the Center Agent and receive replies. The 12 available Apps give the Center Agent explicitly connected tools for files, calendars, email, code, analytics, and Cloudflare. Every connection keeps its own identity, permissions, and audit trail."
			)
		).toBeTruthy();

		const main = container.querySelector("main");
		const footer = container.querySelector("footer");
		expect(main?.nextElementSibling).toBe(footer);
		expect(main?.className).toContain("landing-copy-weight");
		expect(footer?.className).toContain("landing-copy-weight");
		expect(footer?.className).toContain("sticky");
		expect(footer?.className).toContain("bottom-0");
		const fluidLogo = within(footer as HTMLElement).getByTestId(
			"landing-footer-fluid-logo"
		);
		expect(fluidLogo.getAttribute("aria-hidden")).toBe("true");
		const fluidLogoSvg = fluidLogo.querySelector("svg");
		expect(fluidLogoSvg?.getAttribute("viewBox")).toBe("0 0 1600 300");
		expect(fluidLogoSvg?.hasAttribute("preserveAspectRatio")).toBe(false);
		expect(fluidLogoSvg?.className.baseVal).toContain("translate-y-[37.5%]");
		const fluidLogoText = fluidLogo.querySelector("text");
		expect(fluidLogo.querySelectorAll("text")).toHaveLength(1);
		expect(fluidLogoText?.textContent?.trim()).toBe("OpenMeld");
		expect(fluidLogoText?.hasAttribute("textLength")).toBe(false);
		expect(fluidLogoText?.style.fontFamily).toBe(
			"Helvetica, Arial, sans-serif"
		);
		expect(fluidLogo.querySelector("linearGradient")).toBeTruthy();
		const experimentalLabel = within(footer as HTMLElement).getByTestId(
			"landing-footer-experimental"
		);
		expect(experimentalLabel.textContent).toBe("Experimental");
		expect(experimentalLabel.className).toContain("text-amber-600");
		expect(
			within(footer as HTMLElement)
				.getByRole("link", { name: "Changelog" })
				.getAttribute("href")
		).toBe("/changelog");
		expect(
			within(footer as HTMLElement)
				.getByRole("link", { name: "Guide for your agents" })
				.getAttribute("href")
		).toBe("/agent-interface");
		expect(
			within(footer as HTMLElement)
				.getByRole("link", { name: "Install local agents" })
				.getAttribute("href")
		).toBe("/guides/local-agents");
		expect(
			within(footer as HTMLElement)
				.getByRole("link", { name: "Privacy" })
				.getAttribute("href")
		).toBe("/privacy");
	});
});
