import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it } from "vitest";
import {
	useMessagePluginActionRequests,
	usePendingSpacePluginActionRequests,
} from "./plugin-action-requests";

it("renders guest Space approval queries without organization context or network work", () => {
	const client = new QueryClient();
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result, unmount } = renderHook(
		() => ({
			pending: usePendingSpacePluginActionRequests("guest-space", null),
			messages: useMessagePluginActionRequests("guest-space", [
				"visible-message",
			]),
		}),
		{ wrapper }
	);
	expect(result.current.pending.conversation).toEqual([]);
	expect(result.current.pending.thread).toEqual([]);
	expect(result.current.pending.fetchStatus).toBe("idle");
	expect(result.current.messages.fetchStatus).toBe("idle");
	expect(client.isFetching()).toBe(0);
	unmount();
	client.clear();
});
