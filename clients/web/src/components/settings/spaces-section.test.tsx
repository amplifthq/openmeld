import { ShapeProvider } from "@openmeld/ui/lib/shape-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMessagePreviews } from "#/components/spaces/use-message-previews";
import { writeSpaceConversationLayoutPreference } from "#/lib/spaces/conversation-layout-preference";
import { writeSpaceSelfMessageAlignmentPreference } from "#/lib/spaces/self-message-alignment-preference";
import { SpacesSection } from "./spaces-section";

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org", name: "Review lab" },
		currentUserId: "user",
	}),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human" },
	}),
}));

afterEach(() => {
	cleanup();
	localStorage.clear();
	for (const attribute of [
		"data-space-history-slider",
		"data-space-conversation-layout",
		"data-space-self-message-alignment",
	]) {
		document.documentElement.removeAttribute(attribute);
	}
});

function PreviewConsumer() {
	const previews = useMessagePreviews("human", "org");
	return (
		<button
			onClick={() =>
				previews.setShowMessagePreviews(!previews.showMessagePreviews)
			}
			type="button"
		>
			Sidebar previews {previews.showMessagePreviews ? "shown" : "hidden"}
		</button>
	);
}
function renderSettings() {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(["space-preferences", "user"], {
		automaticWakeEnabled: true,
	});
	const view = render(
		<QueryClientProvider client={client}>
			<ShapeProvider>
				<SpacesSection />
				<PreviewConsumer />
			</ShapeProvider>
		</QueryClientProvider>
	);
	return { ...view, client };
}

it("keeps the existing layout, alignment, and history preferences after moving to Spaces", () => {
	writeSpaceConversationLayoutPreference("centered");
	writeSpaceSelfMessageAlignmentPreference("left");
	localStorage.setItem("openmeld.space.history-slider", "off");
	const { client } = renderSettings();
	for (const label of ["Centered", "Left", "Hide"]) {
		expect(
			screen.getByRole("radio", { name: label }).getAttribute("aria-checked")
		).toBe("true");
	}
	fireEvent.click(screen.getByRole("radio", { name: "Full width" }));
	fireEvent.click(screen.getByRole("radio", { name: "Right" }));
	fireEvent.click(screen.getByRole("radio", { name: "Show" }));
	expect(
		document.documentElement.getAttribute("data-space-history-slider")
	).toBe("on");
	cleanup();
	client.clear();
	const remount = renderSettings();
	for (const label of ["Full width", "Right", "Show"]) {
		expect(
			screen.getByRole("radio", { name: label }).getAttribute("aria-checked")
		).toBe("true");
	}
	remount.client.clear();
});

it("shares message-preview changes with the existing sidebar preference in both directions", () => {
	const { client } = renderSettings();
	const group = screen.getByRole("radiogroup", { name: "Message previews" });
	// Shown by default, in both places.
	expect(
		within(group)
			.getByRole("radio", { name: "Show previews" })
			.getAttribute("aria-checked")
	).toBe("true");
	fireEvent.click(within(group).getByRole("radio", { name: "Hide previews" }));
	expect(
		screen.getByRole("button", { name: "Sidebar previews hidden" })
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Sidebar previews hidden" })
	);
	expect(
		within(group)
			.getByRole("radio", { name: "Show previews" })
			.getAttribute("aria-checked")
	).toBe("true");
	expect(
		screen.getByRole("button", { name: "Sidebar previews shown" })
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Sidebar previews shown" })
	);
	expect(
		within(group)
			.getByRole("radio", { name: "Hide previews" })
			.getAttribute("aria-checked")
	).toBe("true");
	client.clear();
});
