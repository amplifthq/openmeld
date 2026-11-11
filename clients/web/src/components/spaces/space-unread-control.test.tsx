import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceConversationUnreadControl } from "./space-unread-control";

vi.mock("@shadcn/react/message-scroller", () => ({
	useMessageScrollerScrollable: () => ({ end: true }),
}));

afterEach(cleanup);
const first = {
	itemId: "first",
	signalId: "first",
	occurredAtMs: 1,
	threadRootSignalId: null,
};
const second = {
	itemId: "second",
	signalId: "second",
	occurredAtMs: 2,
	threadRootSignalId: "root",
};
describe("persistent Space unread control", () => {
	it("leaves the open Thread's replies to its panel while keeping the main target reachable", async () => {
		const navigate = vi.fn().mockResolvedValue(true);
		const ui = (targets: (typeof first | typeof second)[]) => (
			<TooltipProvider>
				<SpaceConversationUnreadControl
					count={targets.length}
					firstUnreadSignalId={null}
					onNavigate={navigate}
					openThreadRootSignalId="root"
					targets={targets}
				/>
			</TooltipProvider>
		);
		const { rerender } = render(ui([second]));
		expect(screen.queryByRole("button")).toBeNull();
		rerender(ui([second, first]));
		fireEvent.click(
			screen.getByRole("button", {
				name: "1 unread in main conversation. Jump to first unread",
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalledWith(first));
		rerender(ui([second]));
		expect(screen.queryByRole("button")).toBeNull();
	});
});
