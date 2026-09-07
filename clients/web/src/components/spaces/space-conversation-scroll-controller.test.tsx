import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceConversationSendScrollController } from "./space-conversation-scroll-controller";
import { buildSpaceConversationScrollRestorationId } from "./space-conversation-scroll-restoration";

const scrollToEndMock = vi.hoisted(() => vi.fn());
const onSendStart = vi.fn();

vi.mock("@shadcn/react/message-scroller", () => ({
	useMessageScroller: () => ({
		scrollToEnd: scrollToEndMock,
	}),
}));

describe("SpaceConversationSendScrollController", () => {
	beforeEach(() => {
		scrollToEndMock.mockReset();
		onSendStart.mockReset();
	});

	it("returns to the live edge when a send starts", () => {
		const view = render(
			<SpaceConversationSendScrollController
				isSendingMessage={false}
				onSendStart={onSendStart}
			/>
		);

		view.rerender(
			<SpaceConversationSendScrollController
				isSendingMessage={true}
				onSendStart={onSendStart}
			/>
		);
		view.rerender(
			<SpaceConversationSendScrollController
				isSendingMessage={true}
				onSendStart={onSendStart}
			/>
		);

		expect(scrollToEndMock).toHaveBeenCalledTimes(1);
		expect(onSendStart).toHaveBeenCalledTimes(1);
		expect(scrollToEndMock).toHaveBeenCalledWith({ behavior: "auto" });
	});

	it("does not override a restored position for an already pending send", () => {
		render(
			<SpaceConversationSendScrollController
				isSendingMessage={true}
				onSendStart={onSendStart}
			/>
		);

		expect(scrollToEndMock).not.toHaveBeenCalled();
		expect(onSendStart).not.toHaveBeenCalled();
	});
});

describe("buildSpaceConversationScrollRestorationId", () => {
	it("scopes the nested viewport position to one Space", () => {
		expect(buildSpaceConversationScrollRestorationId("space-1")).toBe(
			"space-conversation:space-1"
		);
		expect(
			buildSpaceConversationScrollRestorationId(undefined)
		).toBeUndefined();
	});
});
