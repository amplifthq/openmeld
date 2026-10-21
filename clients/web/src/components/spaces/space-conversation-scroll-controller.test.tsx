import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SpaceConversationSendScrollController,
	type SpaceMessageScrollAction,
	SpaceMessageScrollController,
	scrollMessageIntoConversationViewport,
} from "./space-conversation-scroll-controller";
import { buildSpaceConversationScrollRestorationId } from "./space-conversation-scroll-restoration";

const scrollToEndMock = vi.hoisted(() => vi.fn());
const scrollToMessageMock = vi.hoisted(() => vi.fn());
const scrollToStartMock = vi.hoisted(() => vi.fn());
const onSendStart = vi.fn();

vi.mock("@shadcn/react/message-scroller", () => ({
	useMessageScroller: () => ({
		scrollToEnd: scrollToEndMock,
		scrollToMessage: scrollToMessageMock,
		scrollToStart: scrollToStartMock,
	}),
}));

describe("SpaceMessageScrollController", () => {
	beforeEach(() => {
		scrollToEndMock.mockReset();
		scrollToStartMock.mockReset();
	});

	it.each([
		{ direction: "down", deltaY: 80, scrollTop: 500 },
		{ direction: "up", deltaY: -80, scrollTop: 350 },
	] as const)("releases the temporary jump space after scrolling $direction", ({
		direction,
		deltaY,
		scrollTop,
	}) => {
		const root = document.createElement("div");
		root.dataset.slot = "message-scroller";
		const viewport = document.createElement("div");
		const spacer = document.createElement("div");
		spacer.dataset.messageScrollerSpacer = "";
		spacer.style.height = "200px";
		viewport.appendChild(spacer);
		root.appendChild(viewport);
		document.body.appendChild(root);
		Object.defineProperties(viewport, {
			clientHeight: { value: 400 },
			scrollHeight: { value: 1000 },
		});
		Object.defineProperty(spacer, "offsetHeight", { value: 200 });
		viewport.scrollTop = scrollTop;
		const frame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				callback(0);
				return 1;
			});
		scrollToStartMock.mockImplementation(() => {
			spacer.style.height = "0px";
			viewport.scrollTop = 0;
		});
		try {
			const view = render(
				<SpaceMessageScrollController
					actionRef={createRef<SpaceMessageScrollAction | null>()}
					scrollElement={viewport}
				/>
			);
			fireEvent.wheel(viewport, { deltaY });
			if (direction === "down") {
				expect(scrollToEndMock).toHaveBeenCalledWith({ behavior: "auto" });
			} else {
				expect(scrollToStartMock).toHaveBeenCalledWith({ behavior: "auto" });
				expect(viewport.scrollTop).toBe(scrollTop);
			}
			view.unmount();
		} finally {
			frame.mockRestore();
			root.remove();
		}
	});

	it("releases a focus spacer when a newer message arrives", () => {
		const viewport = document.createElement("div");
		const spacer = document.createElement("div");
		spacer.dataset.messageScrollerSpacer = "";
		spacer.style.height = "240px";
		viewport.appendChild(spacer);
		const actionRef = createRef<SpaceMessageScrollAction | null>();
		const view = render(
			<SpaceMessageScrollController
				actionRef={actionRef}
				latestMessageId="message-1"
				scrollElement={viewport}
			/>
		);
		view.rerender(
			<SpaceMessageScrollController
				actionRef={actionRef}
				latestMessageId="message-2"
				scrollElement={viewport}
			/>
		);
		expect(scrollToEndMock).toHaveBeenCalledWith({ behavior: "auto" });
	});

	it("keeps the reading position when no focus spacer exists", () => {
		const viewport = document.createElement("div");
		const actionRef = createRef<SpaceMessageScrollAction | null>();
		const view = render(
			<SpaceMessageScrollController
				actionRef={actionRef}
				latestMessageId="message-1"
				scrollElement={viewport}
			/>
		);
		view.rerender(
			<SpaceMessageScrollController
				actionRef={actionRef}
				latestMessageId="message-2"
				scrollElement={viewport}
			/>
		);
		expect(scrollToEndMock).not.toHaveBeenCalled();
	});
});

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

describe("scrollMessageIntoConversationViewport", () => {
	it("places a requested offset exactly in a scaled viewport", () => {
		const scrollElement = document.createElement("div");
		const messageElement = document.createElement("div");
		Object.defineProperty(scrollElement, "offsetHeight", { value: 600 });
		scrollElement.scrollTop = 0;
		// Rendered at 50% scale: 600 layout pixels occupy 300 screen pixels.
		vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 400, 300)
		);
		vi.spyOn(messageElement, "getBoundingClientRect").mockImplementation(
			() => new DOMRect(0, 500 - scrollElement.scrollTop / 2, 400, 30)
		);
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});

		scrollMessageIntoConversationViewport({
			messageElement,
			offsetFromVisibleTop: 24,
			scrollElement,
		});
		expect(scrollElement.scrollTop).toBe(952);
		while (frames.length > 0) {
			frames.shift()?.(0);
		}

		expect(messageElement.getBoundingClientRect().top).toBe(24);
		vi.restoreAllMocks();
	});
});
