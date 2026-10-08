import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopDownloadsPage } from "./desktop-downloads";

const DOWNLOAD_LABEL = /^Download for/;
const INSTALLATION_LABEL = /^Installation details/;

describe("Desktop downloads", () => {
	afterEach(cleanup);
	it.each([
		"macos-arm64",
		"windows-x64",
		"windows-arm64",
	] as const)("keeps the displayed candidate bound to its download: %s", async (platform) => {
		const downloadPath = `/desktop/download?candidate=${"a".repeat(64)}`;
		render(
			<DesktopDownloadsPage
				candidate
				downloads={{
					releases: [
						{
							platform,
							version: "0.1.25",
							sizeBytes: 151_512_850,
							downloadPath,
							message: null,
						},
					],
				}}
			/>
		);
		const card = screen
			.getByRole("heading", {
				name: platform === "macos-arm64" ? "macOS" : "Windows",
			})
			.closest("section");
		if (!card) {
			throw new Error("Missing platform card.");
		}
		const view = within(card);
		expect(
			view.getByRole("link", { name: DOWNLOAD_LABEL }).getAttribute("href")
		).toBe(downloadPath);
		expect(
			view.getByText(
				`Version 0.1.25 · ${platform === "macos-arm64" ? "DMG" : "EXE"} · 152 MB`
			)
		).toBeTruthy();
		expect(Boolean(view.queryByText("Preview"))).toBe(
			platform !== "macos-arm64"
		);
		fireEvent.click(view.getByRole("button", { name: INSTALLATION_LABEL }));
		expect(
			await view.findByText(
				platform === "macos-arm64"
					? "Open OpenMeld Desktop from Applications."
					: "Open OpenMeld from the Start menu."
			)
		).toBeTruthy();
	});
	it.each([
		false,
		true,
	])("offers no unrelated download for unavailable data, candidate=%s", (candidate) => {
		render(
			<DesktopDownloadsPage
				candidate={candidate}
				downloads={{ releases: [] }}
			/>
		);
		expect(screen.queryByRole("link", { name: DOWNLOAD_LABEL })).toBeNull();
	});
	it("retains the Windows release notice and both platforms' installation steps", async () => {
		render(
			<DesktopDownloadsPage
				downloads={{
					releases: [
						{
							platform: "macos-arm64",
							version: "0.1.25",
							sizeBytes: 100,
							downloadPath: "/desktop/download",
							message: null,
						},
						{
							platform: "windows-x64",
							version: "0.1.26",
							sizeBytes: 200,
							downloadPath: "/desktop/download?platform=windows-x64",
							message:
								"This installer is unsigned. Automatic updates are unavailable.",
						},
					],
				}}
			/>
		);
		for (const trigger of screen.getAllByRole("button", {
			name: INSTALLATION_LABEL,
		})) {
			fireEvent.click(trigger);
		}
		expect(
			await screen.findByText(
				"This installer is unsigned. Automatic updates are unavailable."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Open the downloaded DMG and drag OpenMeld Desktop to Applications."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Open the downloaded installer and install OpenMeld for your Windows account."
			)
		).toBeTruthy();
		expect(
			screen.queryByText("All builds and installation details")
		).toBeNull();
	});
});
