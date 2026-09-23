import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configQueryKeys } from "#/query/query-keys";
import vendorModelCatalog from "../../../../../release/vendor-models.json";
import { RemoteAgentCreationForm } from "./remote-agent-creation-form";

afterEach(cleanup);

describe("Remote Agent creation", () => {
	it("requires a new model after the user changes provider", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(configQueryKeys.modelCatalog, vendorModelCatalog);
		render(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<RemoteAgentCreationForm
						accountName="Felix"
						currentUserId="user-a"
						intentStorageScope="test-scope"
						onAccepted={vi.fn()}
						onCancel={vi.fn()}
						onFailed={vi.fn()}
						onStarted={vi.fn()}
						organizationId="org-a"
						requestedSpaceId={null}
					/>
				</TooltipProvider>
			</QueryClientProvider>
		);
		const createButton = screen.getByRole("button", { name: "Create Agent" });
		expect(createButton).toHaveProperty("disabled", false);
		fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
		fireEvent.click(await screen.findByRole("option", { name: "OpenAI" }));
		expect(
			screen.getByRole("combobox", { name: "Model" }).textContent
		).toContain("Choose a model");
		expect(createButton).toHaveProperty("disabled", true);
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(await screen.findByRole("option", { name: "GPT-6 Astra" }));
		expect(createButton).toHaveProperty("disabled", false);
		queryClient.clear();
	});
});
