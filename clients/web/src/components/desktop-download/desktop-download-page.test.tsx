import type { OpenMeldLogoStrongProps } from "@openmeld/ui/components/openmeld-logo-strong";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDownloadPage } from "./desktop-download-page";

const useNavigateMock = vi.hoisted(() => vi.fn());
const UNSIGNED_WARNING_RE = /This preview is unsigned and not notarized/u;
const CONTROL_CLICK_OPEN_RE = /Control-click the app and choose Open/u;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => useNavigateMock,
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: "/desktop" } }),
}));

vi.mock("@openmeld/ui/components/openmeld-logo-strong", () => ({
	OpenMeldLogoStrong: ({ className, size }: OpenMeldLogoStrongProps) => (
		<img
			alt="OpenMeld logo"
			data-class-name={className}
			data-size={size}
			height={1}
			src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
			width={1}
		/>
	),
}));

describe("DesktopDownloadPage", () => {
	afterEach(() => {
		cleanup();
		useNavigateMock.mockReset();
	});

	it("publishes the unsigned OpenMeld Desktop download entry", () => {
		render(<DesktopDownloadPage />);

		expect(
			screen.getByRole("heading", { name: "OpenMeld Desktop for macOS" })
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Download OpenMeld Desktop" })
				.getAttribute("href")
		).toBe("/desktop/download");
		expect(
			screen
				.getByRole("link", { name: "Open OpenMeld Web" })
				.getAttribute("href")
		).toBe("/login");
		expect(screen.getByText("Unsigned Apple silicon preview")).toBeTruthy();
		expect(screen.getByText("Latest uploaded preview")).toBeTruthy();
		expect(
			screen.getByRole("img", { name: "OpenMeld logo" }).dataset.size
		).toBe("clamp(0.45rem,1.8vw,1.2rem)");
	});

	it("sets clear requirements and Gatekeeper guidance", () => {
		render(<DesktopDownloadPage />);

		expect(screen.getByText("Apple silicon only")).toBeTruthy();
		expect(screen.getByText("Node.js LTS with npm")).toBeTruthy();
		expect(screen.getByText(UNSIGNED_WARNING_RE)).toBeTruthy();
		expect(screen.getByText(CONTROL_CLICK_OPEN_RE)).toBeTruthy();
		const detailGrid = screen.getByTestId("desktop-detail-grid");
		expect(detailGrid.className).toContain("md:grid-cols-2");
		expect(detailGrid.querySelectorAll("section.rounded-md")).toHaveLength(3);
	});
});
