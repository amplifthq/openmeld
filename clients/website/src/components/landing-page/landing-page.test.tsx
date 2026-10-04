import type { OpenMeldLogoStrongProps } from "@openmeld/ui/components/openmeld-logo-strong";
import { cleanup, render, screen, within } from "@testing-library/react";
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

	it("links to the App without reading a session", () => {
		render(<LandingPage />);
		expect(
			screen.getByRole("link", { name: "Open app" }).getAttribute("href")
		).toBe("https://app.openmeld.ai/");
		expect(
			screen
				.getByRole("link", { name: "Start with your Center Agent" })
				.getAttribute("href")
		).toBe("https://app.openmeld.ai/");
		const slack = screen.getByRole("link", { name: "Add to Slack" });
		expect(slack.getAttribute("href")).toBe(
			"https://app.openmeld.ai/add-to-slack"
		);
		expect(within(slack).getByTestId("slack-mark-icon")).toBeTruthy();
	});
});
