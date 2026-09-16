import type {
	DesktopSpaceStreamBridge,
	DesktopSpaceStreamEvent,
} from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { createSpaceLiveTransport } from "./live-transport";

afterEach(() => vi.unstubAllGlobals());

it("delivers native frames and close details through the existing socket listener contract", async () => {
	let deliver: ((event: DesktopSpaceStreamEvent) => void) | undefined;
	const unsubscribe = vi.fn();
	const open = vi
		.fn<DesktopSpaceStreamBridge["spaceStreamOpen"]>()
		.mockResolvedValue(undefined);
	const ping = vi
		.fn<DesktopSpaceStreamBridge["spaceStreamPing"]>()
		.mockResolvedValue(undefined);
	const close = vi
		.fn<DesktopSpaceStreamBridge["spaceStreamClose"]>()
		.mockResolvedValue(undefined);
	const bridge: DesktopSpaceStreamBridge = {
		spaceStreamOpen: open,
		spaceStreamPing: ping,
		spaceStreamClose: close,
		onSpaceStream: (listener) => {
			deliver = listener;
			return unsubscribe;
		},
	};
	vi.stubGlobal("window", { openmeldDesktop: bridge });
	const socket = createSpaceLiveTransport({
		origin: "openmeld-desktop://app",
		spaceId: "space-a",
		profileId: "profile-a",
	});
	const subscription = open.mock.calls[0]?.[0];
	if (!(subscription && deliver)) {
		throw new Error("Expected a native subscription");
	}
	expect(subscription).toMatchObject({
		spaceId: "space-a",
		profileId: "profile-a",
	});
	const listener = vi.fn();
	socket.addEventListener("message", listener);
	deliver({
		id: "10000000-0000-4000-8000-000000000001",
		type: "message",
		data: "foreign",
	});
	expect(listener).not.toHaveBeenCalled();
	deliver({ id: subscription.id, type: "message", data: "pong" });
	expect(listener.mock.calls[0]?.[0].data).toBe("pong");
	socket.send("ping");
	expect(ping).toHaveBeenCalledWith(subscription.id);
	expect(() => socket.send("business mutation")).toThrow("keepalive");
	const closeListener = vi.fn();
	socket.addEventListener("close", closeListener);
	deliver({
		id: subscription.id,
		type: "close",
		code: 1008,
		reason: "space_access_changed",
	});
	const closeEvent = closeListener.mock.calls[0]?.[0];
	expect(closeEvent).toBeInstanceOf(CloseEvent);
	expect(closeEvent).toMatchObject({
		code: 1008,
		reason: "space_access_changed",
	});
	expect(close).not.toHaveBeenCalled();
	expect(unsubscribe).toHaveBeenCalledOnce();
	deliver({ id: subscription.id, type: "message", data: "stale" });
	expect(listener).toHaveBeenCalledTimes(1);
	await Promise.resolve();
});

it("closes the native bridge explicitly without inventing remote close details", async () => {
	const unsubscribe = vi.fn();
	const close = vi.fn().mockResolvedValue(undefined);
	const bridge: DesktopSpaceStreamBridge = {
		spaceStreamOpen: vi.fn().mockResolvedValue(undefined),
		spaceStreamPing: vi.fn().mockResolvedValue(undefined),
		spaceStreamClose: close,
		onSpaceStream: () => unsubscribe,
	};
	vi.stubGlobal("window", { openmeldDesktop: bridge });
	const socket = createSpaceLiveTransport({
		origin: "openmeld-desktop://app",
		spaceId: "space-a",
		profileId: "profile-a",
	});
	const listener = vi.fn();
	socket.addEventListener("close", listener);

	socket.close();
	await Promise.resolve();

	expect(close).toHaveBeenCalledOnce();
	expect(unsubscribe).toHaveBeenCalledOnce();
	expect(listener.mock.calls[0]?.[0]).toEqual(new Event("close"));
});
