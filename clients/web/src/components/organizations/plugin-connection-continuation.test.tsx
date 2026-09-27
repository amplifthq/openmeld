import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { PluginConnectionContinuation } from "./plugin-connection-continuation";

const requestJson = vi.hoisted(() => vi.fn());
const foundation = vi.hoisted(() => vi.fn());
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: foundation,
}));

const input = {
	organizationId: "org-a",
	spaceId: "space-a",
	sourceSignalId: "reply-a",
	service: "github" as const,
	scope: "member" as const,
};
const requested = {
	status: "requested",
	spaceId: "space-a",
	sourceSignalId: "reply-a",
	signalId: "continuation-a",
	targetProfileId: "agent-a",
	threadId: null,
};

describe("explicit Plugin task continuation", () => {
	beforeEach(() => {
		requestJson.mockReset();
		foundation.mockReset().mockReturnValue({ requestJson });
	});
	afterEach(cleanup);
	it("uses the same explicit click for an external request and never resumes from mounting or OAuth completion", async () => {
		requestJson.mockResolvedValue({
			status: "requested",
			requestId: "external",
			provider: "slack",
			targetProfileId: "agent",
		});
		const view = render(
			<TestQueryClientProvider>
				<PluginConnectionContinuation
					channelRequestId="external"
					connected={false}
					organizationId="org-a"
					scope="shared"
					service="github"
				/>
			</TestQueryClientProvider>
		);
		view.rerender(
			<TestQueryClientProvider>
				<PluginConnectionContinuation
					channelRequestId="external"
					connected
					organizationId="org-a"
					scope="shared"
					service="github"
				/>
			</TestQueryClientProvider>
		);
		expect(requestJson).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		await waitFor(() => expect(requestJson).toHaveBeenCalledOnce());
		const request = requestJson.mock.calls[0][0];
		expect(request.url).toBe(
			"/v1/organizations/current/plugins/connection-requests/continue?expectedOrganizationId=org-a"
		);
		expect(JSON.parse(request.body)).toEqual({
			requestId: "external",
			scope: "shared",
		});
		expect(
			await screen.findByText(
				"Continuation requested. The Agent will report its result in the original conversation."
			)
		).toBeTruthy();
	});

	it("does not run work on mount or connection completion; one human click uses only the original reply identity", async () => {
		let resolvePending!: (value: typeof requested) => void;
		const pending = {
			promise: new Promise<typeof requested>((resolve) => {
				resolvePending = resolve;
			}),
			resolve: (value: typeof requested) => resolvePending(value),
		};
		requestJson.mockReturnValue(pending.promise);
		const client = createTestQueryClient();
		const view = render(
			<TestQueryClientProvider queryClient={client}>
				<PluginConnectionContinuation {...input} connected={false} />
			</TestQueryClientProvider>
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Continue original task",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		view.rerender(
			<TestQueryClientProvider queryClient={client}>
				<PluginConnectionContinuation {...input} connected />
			</TestQueryClientProvider>
		);
		expect(requestJson).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		await waitFor(() => expect(requestJson).toHaveBeenCalledOnce());
		expect(foundation).toHaveBeenCalledWith({ organizationId: "org-a" });
		const request = requestJson.mock.calls[0][0];
		expect(request.url).toBe("/v1/spaces/space-a/plugin-connection/continue");
		expect(JSON.parse(request.body)).toEqual({
			sourceSignalId: "reply-a",
			service: "github",
			scope: "member",
		});
		expect(
			(
				screen.getByRole("button", {
					name: "Requesting continuation…",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		await act(async () => {
			pending.resolve(requested);
			await pending.promise;
		});
		expect(
			await screen.findByText(
				"Continuation requested. The Agent will report its result in the original conversation."
			)
		).toBeTruthy();
		expect(screen.queryByText("Task completed")).toBeNull();
	});

	it("keeps the same request on a transport retry and displays the server's authority failure", async () => {
		requestJson.mockRejectedValueOnce(
			new Error("Only the original requester can continue.")
		);
		requestJson.mockResolvedValueOnce(requested);
		render(
			<TestQueryClientProvider>
				<PluginConnectionContinuation {...input} connected />
			</TestQueryClientProvider>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Only the original requester can continue."
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
		expect(requestJson.mock.calls[1][0].body).toBe(
			requestJson.mock.calls[0][0].body
		);
	});
});
