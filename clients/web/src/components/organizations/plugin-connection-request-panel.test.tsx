import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { PluginConnectionRequestPanel } from "./plugin-connection-request-panel";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	foundation: vi.fn(),
	panel: vi.fn(),
	organization: {
		currentOrganization: {
			id: "org",
			slug: "acme",
			name: "Acme",
			isPersonal: false,
		},
		currentUserId: "human",
	},
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: mocks.foundation,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => mocks.organization,
}));
vi.mock("./plugin-connection-message-card", () => ({
	PluginConnectionSetupPanel: (props: unknown) => {
		mocks.panel(props);
		return <div>Existing shared setup surface</div>;
	},
}));
const preview = {
	requestId: "request",
	service: "github",
	scope: "shared",
	provider: "slack",
	targetProfileName: "Agent",
	expiresAtMs: 1000,
	selection: null,
};
beforeEach(() => {
	mocks.request
		.mockReset()
		.mockImplementation(({ operation }) =>
			Promise.resolve(
				operation === "plugin.channel.preview"
					? preview
					: { organizationId: "org", providers: [] }
			)
		);
	mocks.foundation.mockReset().mockReturnValue({ requestJson: mocks.request });
	mocks.panel.mockReset();
});
afterEach(cleanup);
describe("private channel request page reuses setup without becoming an authority", () => {
	it("recovers a failed provider catalog through the visible retry action", async () => {
		let catalogUnavailable = true;
		mocks.request.mockImplementation(({ operation }) => {
			if (operation === "plugin.channel.preview") {
				return Promise.resolve(preview);
			}
			return catalogUnavailable
				? Promise.reject(new Error("Provider catalog unavailable"))
				: Promise.resolve({ organizationId: "org", providers: [] });
		});
		render(
			<TestQueryClientProvider>
				<PluginConnectionRequestPanel requestId="request" service="github" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(mocks.panel).not.toHaveBeenCalled();
		catalogUnavailable = false;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			await screen.findByText("Existing shared setup surface")
		).toBeTruthy();
	});
	it("uses only server-verified service and account intent, and rendering never starts continuation", async () => {
		render(
			<TestQueryClientProvider>
				<PluginConnectionRequestPanel requestId="request" service="github" />
			</TestQueryClientProvider>
		);
		expect(
			await screen.findByText("Existing shared setup surface")
		).toBeTruthy();
		expect(mocks.panel).toHaveBeenLastCalledWith(
			expect.objectContaining({
				target: {
					kind: "plugin_connection",
					service: "github",
					scope: "shared",
				},
				continuation: { channelRequestId: "request" },
				currentUserId: "human",
			})
		);
		const previewCalls = mocks.request.mock.calls.filter(
			([request]) => request.operation === "plugin.channel.preview"
		);
		expect(previewCalls).toHaveLength(1);
		expect(previewCalls[0][0].url).toContain(
			"/preview?expectedOrganizationId=org"
		);
		expect(mocks.foundation).toHaveBeenCalledWith({ organizationId: "org" });
	});
	it.each([
		"identity_denied",
		"wrong_service",
	])("does not show setup or continuation on %s", async (mode) => {
		if (mode === "identity_denied") {
			mocks.request.mockRejectedValue(
				new Error("Only the original requester can continue")
			);
		} else {
			mocks.request.mockResolvedValue({ ...preview, service: "linear" });
		}
		render(
			<TestQueryClientProvider>
				<PluginConnectionRequestPanel requestId="request" service="github" />
			</TestQueryClientProvider>
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(mocks.panel).not.toHaveBeenCalled();
	});
	it.each([
		"member",
		"shared",
	])("honors a previously pinned %s choice rather than rechoosing when both connections exist", async (selection) => {
		mocks.request.mockImplementation(({ operation }) =>
			Promise.resolve(
				operation === "plugin.channel.preview"
					? { ...preview, scope: "choose", selection }
					: { organizationId: "org", providers: [] }
			)
		);
		render(
			<TestQueryClientProvider>
				<PluginConnectionRequestPanel requestId="request" service="github" />
			</TestQueryClientProvider>
		);
		await waitFor(() => expect(mocks.panel).toHaveBeenCalled());
		expect(mocks.panel).toHaveBeenLastCalledWith(
			expect.objectContaining({
				target: expect.objectContaining({ scope: selection }),
			})
		);
	});
});
