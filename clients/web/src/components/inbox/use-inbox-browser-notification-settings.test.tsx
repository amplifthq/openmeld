import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxBrowserNotificationSettings } from "./use-inbox-browser-notification-settings";

const disableMock = vi.hoisted(() => vi.fn());
const enableMock = vi.hoisted(() => vi.fn());
const readSettingsMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/inbox/browser-notifications", () => ({
	disableInboxBrowserNotifications: disableMock,
	enableInboxBrowserNotifications: enableMock,
	readInboxBrowserNotificationSettings: readSettingsMock,
	subscribeInboxBrowserNotificationSettings: subscribeMock,
}));

describe("useInboxBrowserNotificationSettings", () => {
	beforeEach(() => {
		disableMock.mockReset();
		enableMock.mockReset();
		readSettingsMock.mockReset().mockImplementation(({ userId }) => ({
			enabled: userId === "user-enabled",
			permission: "granted",
		}));
		subscribeMock.mockReset().mockReturnValue(() => undefined);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("does not let an old user's pending permission result overwrite the new user", async () => {
		let resolveEnable: ((settings: unknown) => void) | null = null;
		enableMock.mockReturnValue(
			new Promise((resolve) => {
				resolveEnable = resolve;
			})
		);
		const { rerender, result } = renderHook(
			({ userId }: { userId: string }) =>
				useInboxBrowserNotificationSettings(userId),
			{ initialProps: { userId: "user-old" } }
		);

		let oldOperation: Promise<void> | null = null;
		act(() => {
			oldOperation = result.current.setEnabled(true);
		});
		expect(result.current.isPending).toBe(true);

		rerender({ userId: "user-enabled" });
		await waitFor(() => {
			expect(result.current.settings).toEqual({
				enabled: true,
				permission: "granted",
			});
		});

		await act(async () => {
			resolveEnable?.({ enabled: true, permission: "granted" });
			await oldOperation;
		});

		expect(result.current.isPending).toBe(false);
		expect(result.current.settings).toEqual({
			enabled: true,
			permission: "granted",
		});
	});

	it("keeps the current user's pending operation when an older user finishes later", async () => {
		let resolveOld: ((settings: unknown) => void) | undefined;
		let resolveCurrent: ((settings: unknown) => void) | undefined;
		enableMock
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveOld = resolve;
				})
			)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveCurrent = resolve;
				})
			);
		const { rerender, result } = renderHook(
			({ userId }: { userId: string }) =>
				useInboxBrowserNotificationSettings(userId),
			{ initialProps: { userId: "user-old" } }
		);
		let oldOperation: Promise<void> | undefined;
		act(() => {
			oldOperation = result.current.setEnabled(true);
		});

		rerender({ userId: "user-current" });
		let currentOperation: Promise<void> | undefined;
		act(() => {
			currentOperation = result.current.setEnabled(true);
		});
		expect(result.current.isPending).toBe(true);

		await act(async () => {
			resolveOld?.({ enabled: true, permission: "granted" });
			await oldOperation;
		});
		expect(result.current.isPending).toBe(true);

		await act(async () => {
			resolveCurrent?.({ enabled: true, permission: "granted" });
			await currentOperation;
		});
		expect(result.current.isPending).toBe(false);
	});
});
