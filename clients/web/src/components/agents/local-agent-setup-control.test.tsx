import type { LocalAgentSetupState } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalAgentSetupControl } from "./local-agent-setup-control";

const signedIn: LocalAgentSetupState = {
	supported: true,
	installed: true,
	signedIn: true,
	operation: {
		operationId: "e2cc518f-b2be-44e5-92ce-8d3a098c2e2d",
		action: "login",
		status: "succeeded",
		message: "Signed in.",
	},
};
vi.mock("#/lib/connect/local-runtimes", () => ({
	managePeopleComputerLocalAgentSetup: async () => signedIn,
}));
afterEach(cleanup);

it("keeps catalog refresh failures visible after successful sign-in and retries without another login", async () => {
	const refresh = vi
		.fn()
		.mockRejectedValueOnce(new Error("Catalog unavailable"))
		.mockResolvedValue(undefined);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<LocalAgentSetupControl
				agentId="grok-bot"
				onChanged={refresh}
				storageScope="test"
				target={{ deviceId: "computer", runtimeLane: "dev-local" }}
			/>
		</QueryClientProvider>
	);
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Sign in", exact: true })
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Check status" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(refresh).toHaveBeenCalledTimes(2);
	client.clear();
});
