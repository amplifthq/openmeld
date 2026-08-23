import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceInfoNotificationsSection } from "./space-info-notifications-section";

const useOptionalAppOrganizationMock = vi.hoisted(() => vi.fn());
const enableMock = vi.hoisted(() => vi.fn());
const disableMock = vi.hoisted(() => vi.fn());
const readSettingsMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: useOptionalAppOrganizationMock,
}));

vi.mock("#/lib/inbox/browser-notifications", () => {
	return {
		disableInboxBrowserNotifications: disableMock,
		enableInboxBrowserNotifications: enableMock,
		readInboxBrowserNotificationSettings: readSettingsMock,
		subscribeInboxBrowserNotificationSettings: (...args: unknown[]) =>
			subscribeMock(...args),
	};
});

vi.mock("#/components/inbox/browser-notification-toggle", () => ({
	BrowserNotificationControl: (input: {
		onChange: (enabled: boolean) => Promise<void>;
		settings: { enabled: boolean };
	}) => (
		<button
			onClick={() => input.onChange(!input.settings.enabled)}
			type="button"
		>
			toggle-control
		</button>
	),
}));

const GLOBAL_SCOPE_TEXT_PATTERN = /every Space and Direct Message/i;

describe("SpaceInfoNotificationsSection", () => {
	beforeEach(() => {
		enableMock.mockReset().mockResolvedValue({
			enabled: true,
			permission: "granted",
		});
		disableMock.mockReset().mockResolvedValue({
			enabled: false,
			permission: "granted",
		});
		readSettingsMock.mockReset().mockReturnValue({
			enabled: false,
			permission: "granted",
		});
		subscribeMock.mockReset().mockReturnValue(() => undefined);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("does not render without an organization context", () => {
		useOptionalAppOrganizationMock.mockReturnValue(null);
		const { container } = render(<SpaceInfoNotificationsSection />);
		expect(container.innerHTML).toBe("");
	});

	it("describes the global scope and toggles the shared preference", async () => {
		useOptionalAppOrganizationMock.mockReturnValue({
			currentUserId: "user-123",
		});
		render(<SpaceInfoNotificationsSection />);

		const description = screen.getByText(GLOBAL_SCOPE_TEXT_PATTERN);
		expect(description.textContent).toContain("not just this one");
		expect(screen.getByText("Browser notifications")).toBeTruthy();

		fireEvent.click(screen.getByText("toggle-control"));

		await waitFor(() => {
			expect(enableMock).toHaveBeenCalledWith({ userId: "user-123" });
		});
		expect(disableMock).not.toHaveBeenCalled();
	});
});
