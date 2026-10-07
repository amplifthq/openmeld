import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewAgentCreationForm } from "./new-agent-creation-form";

vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: () => ({}),
}));
vi.mock("./create-profile-dialog", () => ({
	CreateAgentProfilePage: ({
		spaceContext,
	}: {
		spaceContext?: { spaceId: string };
	}) => (
		<output data-testid="creation-destination">
			{spaceContext?.spaceId ?? "chat"}
		</output>
	),
}));
vi.mock("./remote-agent-creation-form", () => ({
	RemoteAgentCreationForm: ({
		requestedSpaceId,
	}: {
		requestedSpaceId: string | null;
	}) => (
		<output data-testid="creation-destination">
			{requestedSpaceId ?? "chat"}
		</output>
	),
}));

afterEach(cleanup);

describe("new Agent destination", () => {
	it.each([
		"Choose a Local Agent",
		"Remote Agent",
	])("uses a new chat for %s creation", (runtime) => {
		render(
			<NewAgentCreationForm
				accountName="Felix"
				currentUserId="user-a"
				intentStorageScope="test-scope"
				isPersonalOrganization={true}
				onAccepted={vi.fn()}
				onCancel={vi.fn()}
				onFailed={vi.fn()}
				onStarted={vi.fn()}
				organizationId="org-a"
				orgSlug="acme"
			/>
		);
		expect(screen.queryByText("After creation")).toBeNull();
		expect(screen.queryByRole("button", { name: "Add to a Space" })).toBeNull();
		expect(
			screen
				.getByRole("tab", { name: "Choose a Local Agent" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect(screen.getByTestId("creation-destination").textContent).toBe("chat");
		fireEvent.click(screen.getByRole("tab", { name: runtime }));
		expect(screen.getByTestId("creation-destination").textContent).toBe("chat");
	});
});
