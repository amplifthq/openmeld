import type { PluginActionRequestView } from "@openmeld/schemas/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginActionRequest } from "./plugin-action-request";

const state = vi.hoisted(() => ({
	request: {} as PluginActionRequestView,
	respond: vi.fn(),
}));
vi.mock("#/query/organizations/plugin-action-requests", () => ({
	usePluginActionRequest: () => ({
		query: { data: state.request, isPending: false, refetch: vi.fn() },
		mutation: { mutateAsync: state.respond, reset: vi.fn(), isPending: false },
	}),
}));
afterEach(cleanup);

it.each([
	"Product engineering",
	null,
])("shows the saved issue with target name %s and approves the same request", (name) => {
	state.request = {
		requestId: "11111111-1111-4111-8111-111111111111",
		inboxItemId: "inbox",
		service: "linear",
		actionId: "linear.create_linear_issue",
		effect: "write",
		accountName: "Carol Chen",
		accountScope: "shared",
		actorProfileId: "agent",
		state: "pending",
		targets: [{ label: "teamId", value: "team-id" }],
		inputFieldCount: 3,
		createdAtMs: 1,
		expiresAtMs: 2,
		sourceSignalId: "source",
		issuePreview: {
			title: "Investigate daily error rate",
			description: "First line\n<img src=x onerror=alert(1)>\n最后一行",
			targets: [{ label: "Team", id: "team-id", name }],
			additionalFieldCount: 0,
		},
	};
	const { container } = render(
		<PluginActionRequest requestId={state.request.requestId} />
	);
	expect(
		screen.getByRole("heading", { name: "Create Linear issue" })
	).toBeTruthy();
	expect(screen.getByText(name ?? "Name unavailable")).toBeTruthy();
	expect(screen.getByText("team-id")).toBeTruthy();
	expect(screen.getByText("Investigate daily error rate")).toBeTruthy();
	expect(container.textContent).toContain(
		"First line\n<img src=x onerror=alert(1)>\n最后一行"
	);
	expect(container.querySelector("img")).toBeNull();
	expect(container.textContent).not.toContain("linear.create_linear_issue");
	fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
	expect(state.respond).toHaveBeenCalledWith({
		operation: "approve",
		requestId: state.request.requestId,
	});
});
