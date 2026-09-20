import type { DesktopUpdaterState } from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxDesktopUpdateDetails } from "./inbox-desktop-update-details";

const state = vi.hoisted(() => ({
	native: null as DesktopUpdaterState | null,
	settings: vi.fn(() => Promise.resolve()),
}));
vi.mock("#/desktop/updater", () => ({ useDesktopUpdater: () => state.native }));
vi.mock("#/components/settings/use-app-settings", () => ({
	useAppSettings: () => state.settings,
}));
afterEach(() => {
	cleanup();
	state.native = null;
	state.settings.mockReset();
});
const target: Extract<InboxItem["sourceTarget"], { kind: "desktop_update" }> = {
	kind: "desktop_update",
	installationId: "11111111-2222-4333-8444-555555555555",
	lane: "dev-local",
	deviceName: "Build Mac",
	version: "0.1.4",
	platform: "darwin",
	state: "available",
};
const guidance = /Open OpenMeld Desktop on Build Mac/u;

describe("Desktop update source navigation", () => {
	it("gives browser guidance without pretending to know or install its native version", () => {
		render(<InboxDesktopUpdateDetails target={target} />);
		expect(screen.getByText(guidance)).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
	it("opens the existing Updates entry only on the matching installation and lane", () => {
		state.native = {
			status: "available",
			currentVersion: "0.1.3",
			version: "0.1.4",
			percent: null,
			errorStage: null,
			installationId: target.installationId,
			lane: target.lane,
		};
		const view = render(<InboxDesktopUpdateDetails target={target} />);
		fireEvent.click(screen.getByRole("button", { name: "Open Updates" }));
		expect(state.settings).toHaveBeenCalledWith("updates");
		state.native = { ...state.native, lane: "prod" };
		view.rerender(<InboxDesktopUpdateDetails target={target} />);
		expect(screen.queryByRole("button")).toBeNull();
		expect(screen.getByText(guidance)).toBeTruthy();
	});
	it.each([
		"installed",
		"superseded",
	] as const)("does not offer an installation action for %s history", (status) => {
		render(<InboxDesktopUpdateDetails target={{ ...target, state: status }} />);
		expect(screen.queryByRole("button")).toBeNull();
	});
});
