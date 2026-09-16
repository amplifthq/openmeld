import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	AuthView,
	ServiceView,
} from "../../../desktop/src/shared/view-types";
import { DesktopServiceControls } from "./desktop-service-controls";

const read = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn() }));
const otherAccountMessage = /connected to another account/u;
const obsoleteUpdateAdvice = /Update OpenMeld through Web/u;
vi.mock("./platform", () => ({ getDesktopPlatform: () => ({}) }));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentUserId: "account-a" }),
}));
vi.mock("../../../desktop/src/renderer/ipc", () => ({
	getBridge: () => ({
		getServiceStatus: read.service,
		getAuthStatus: read.auth,
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Desktop local control evidence", () => {
	it.each([
		"missing_device",
		"other_device",
		"missing_account",
		"unknown_account",
		"different_account",
	] as const)("does not infer local identity or account conflicts: %s", async (state) => {
		const signedIn = {
			missing_account: false,
			unknown_account: null,
			different_account: true,
			missing_device: true,
			other_device: true,
		}[state];
		const accountId = {
			missing_account: null,
			unknown_account: null,
			different_account: "account-b",
			missing_device: "account-a",
			other_device: "account-a",
		}[state];
		const deviceId = {
			missing_device: null,
			other_device: "remote-device",
			missing_account: "local-device",
			unknown_account: "local-device",
			different_account: "local-device",
		}[state];
		const auth: AuthView = {
			signedIn,
			accountId,
			email: null,
			problem: null,
		};
		const service: ServiceView = {
			lifecycle: "unknown",
			installed: null,
			running: null,
			autoStart: null,
			cliVersion: null,
			runtimeProjection: null,
			problem: null,
			controlCapabilities: {
				deviceId,
				start: true,
				stop: false,
			},
		};
		read.auth.mockResolvedValue(auth);
		read.service.mockResolvedValue(service);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<DesktopServiceControls deviceId="local-device" />
			</QueryClientProvider>
		);
		await waitFor(() =>
			expect(
				client.getQueryData(["desktop-service-control", "account-a"])
			).toBeDefined()
		);
		if (state === "missing_device" || state === "other_device") {
			expect(screen.queryByText("Background service controls")).toBeNull();
		} else {
			expect(screen.getByText("Background service controls")).toBeTruthy();
			expect(
				screen.getByText("Start Service").closest("button")?.disabled
			).toBe(true);
		}
		expect(Boolean(screen.queryByText(otherAccountMessage))).toBe(
			state === "different_account"
		);
		expect(screen.queryByText(obsoleteUpdateAdvice)).toBeNull();
		client.clear();
	});
});
