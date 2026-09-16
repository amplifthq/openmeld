import type {
	DesktopSpaceStreamBridge,
	DesktopSpaceStreamEvent,
} from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { createSpaceLiveTransport } from "./live-transport";

afterEach(() => vi.unstubAllGlobals());

it("delivers native frames through the existing socket listener contract and detaches on close", async () => {
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
	socket.close();
	expect(close).toHaveBeenCalledWith(subscription.id);
	expect(unsubscribe).toHaveBeenCalledOnce();
	deliver({ id: subscription.id, type: "message", data: "stale" });
	expect(listener).toHaveBeenCalledTimes(1);
	await Promise.resolve();
});
