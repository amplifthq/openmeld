import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDesktopPreviewReleaseManifest } from "#/lib/desktop-release";
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

describe("DesktopDownloadPage", () => {
	afterEach(cleanup);
	it.each([
		false,
		true,
	])("offers a download only with an available release: %s", (available) => {
		const release = available
			? parseDesktopPreviewReleaseManifest({
					latestVersion: "1.0.0",
					message: "Release-specific installation notice.",
					macosArm64: {
						version: "1.0.0",
						artifactName: "OpenMeld.dmg",
						objectKey: "desktop/OpenMeld.dmg",
						sizeBytes: 123_000_000,
					},
				})
			: null;
		render(<DesktopDownloadPage release={release} />);
		const download = screen.queryByRole("link", {
			name: "Download for Apple silicon",
		});
		if (available) {
			expect(download?.getAttribute("href")).toBe("/desktop/download");
			expect(screen.getByText("Version 1.0.0 · DMG · 123 MB")).toBeTruthy();
			expect(
				screen.getByText("Release-specific installation notice.")
			).toBeTruthy();
		} else {
			expect(download).toBeNull();
			expect(screen.getByText("Download not available yet")).toBeTruthy();
		}
		for (const link of screen.getAllByRole("link", {
			name: "Open OpenMeld Web",
		})) {
			expect(link.getAttribute("href")).toBe("/login");
		}
	});
});
