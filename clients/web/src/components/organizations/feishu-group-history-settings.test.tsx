import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { FeishuGroupHistorySettings } from "./feishu-group-history-settings";

const api = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => api,
}));
afterEach(cleanup);
it("keeps the group off until the existing app grant is rechecked and enables exactly that group", async () => {
	const grantUrl =
		"https://open.feishu.cn/page/launcher?clientID=cli_existing&user_code=test";
	const setting = {
		connectionId: "conn",
		generation: 3,
		chatId: "oc_selected",
		enabled: true,
	};
	const page = (enabled: boolean) => ({
		generation: 3,
		groups: [{ chatId: "oc_selected", name: "Pilot", enabled }],
		nextPageToken: null,
	});
	api.requestJson
		.mockResolvedValueOnce(page(false))
		.mockResolvedValueOnce({
			status: "permission_required",
			authorizationUrl: grantUrl,
		})
		.mockResolvedValueOnce(setting)
		.mockResolvedValueOnce(page(true));
	render(
		<TestQueryClientProvider>
			<FeishuGroupHistorySettings connectionId="conn" organizationId="org" />
		</TestQueryClientProvider>
	);
	fireEvent.click(screen.getByRole("button", { name: "Group history" }));
	const toggle = await screen.findByRole("switch", {
		name: "Use group history in Pilot",
	});
	fireEvent.click(toggle);
	expect(
		(
			await screen.findByRole("link", { name: "Update Feishu permissions" })
		).getAttribute("href")
	).toBe(grantUrl);
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	fireEvent.click(
		screen.getByRole("button", {
			name: "I’ve updated permissions. Check again",
		})
	);
	await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
	expect(
		api.requestJson.mock.calls
			.filter(([r]) => r.method === "PUT")
			.map(([r]) => JSON.parse(r.body))
	).toEqual([setting, setting]);
	expect(
		screen.queryByRole("link", { name: "Update Feishu permissions" })
	).toBeNull();
});
