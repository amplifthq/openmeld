import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDownloadPage } from "./desktop-download-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: "/desktop" } }),
}));

const MAC_INSTALL_COPY = /downloaded DMG/;
const DOWNLOAD_LINK_LABEL = /^Download for/;

describe("DesktopDownloadPage", () => {
	afterEach(cleanup);
	it("keeps the download button bound to the displayed candidate", () => {
		const downloadPath = `/desktop/download?candidate=${"a".repeat(64)}`;
		render(
			<DesktopDownloadPage
				release={{
					platform: "macos-arm64",
					version: "0.1.0-preview.0",
					sizeBytes: 151_512_850,
					downloadPath,
					message: null,
				}}
			/>
		);
		expect(
			screen
				.getByRole("link", { name: "Download for Mac (Apple silicon)" })
				.getAttribute("href")
		).toBe(downloadPath);
		expect(
			screen.getByText("Version 0.1.0-preview.0 · DMG · 152 MB")
		).toBeTruthy();
	});
	it.each([
		"windows-x64",
		"windows-arm64",
	] as const)("shows the exact Windows artifact without Mac install instructions: %s", (platform) => {
		const downloadPath = `/desktop/download?candidate=${"b".repeat(64)}`;
		render(
			<DesktopDownloadPage
				platform={platform}
				release={{
					platform,
					version: "0.1.4",
					sizeBytes: 1024,
					downloadPath,
					message: null,
				}}
			/>
		);
		expect(
			screen
				.getByRole("link", {
					name:
						platform === "windows-x64"
							? "Download for Windows (x64)"
							: "Download for Windows (ARM64)",
				})
				.getAttribute("href")
		).toBe(downloadPath);
		expect(screen.getByText("Open OpenMeld from the Start menu.")).toBeTruthy();
		expect(screen.queryByText(MAC_INSTALL_COPY)).toBeNull();
	});
	it("does not offer a Mac download as fallback for an unavailable Windows release", () => {
		render(<DesktopDownloadPage platform="windows-x64" release={null} />);
		expect(
			screen.queryByRole("link", { name: DOWNLOAD_LINK_LABEL })
		).toBeNull();
		expect(
			screen.getByText("Desktop downloads aren't available yet")
		).toBeTruthy();
	});
	it.each([
		"default",
		"candidate",
		"invalid",
	] as const)("offers no download when unavailable: %s", (unavailable) => {
		render(<DesktopDownloadPage release={null} unavailable={unavailable} />);
		expect(
			screen.queryByRole("link", { name: "Download for Mac (Apple silicon)" })
		).toBeNull();
		expect(
			screen
				.getByRole("link", { name: "Open OpenMeld Web" })
				.getAttribute("href")
		).toBe("/login");
	});
});
