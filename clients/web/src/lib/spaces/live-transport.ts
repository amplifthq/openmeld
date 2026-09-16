import { SPACE_STREAM_KEEPALIVE_PING } from "@openmeld/protocol";
import type { DesktopSpaceStreamBridge } from "@openmeld/schemas";
import { createSpaceLiveStreamUrl } from "./live-stream";

export type SpaceLiveTransport = Pick<
	WebSocket,
	"addEventListener" | "removeEventListener" | "send" | "close"
>;

export function createSpaceLiveTransport(input: {
	origin: string;
	spaceId: string;
	profileId: string;
}): SpaceLiveTransport {
	const desktop = (
		window as Window & { openmeldDesktop?: DesktopSpaceStreamBridge }
	).openmeldDesktop;
	return desktop
		? new DesktopSpaceLiveTransport(desktop, input)
		: new WebSocket(createSpaceLiveStreamUrl(input));
}

/** Adapt native socket events only; the shared consumer retains all live-state policy. */
class DesktopSpaceLiveTransport implements SpaceLiveTransport {
	private readonly id = crypto.randomUUID();
	private readonly events = new EventTarget();
	private readonly unsubscribe: () => void;
	private readonly bridge: DesktopSpaceStreamBridge;
	private closed = false;

	constructor(
		bridge: DesktopSpaceStreamBridge,
		input: { spaceId: string; profileId: string }
	) {
		this.bridge = bridge;
		this.unsubscribe = bridge.onSpaceStream((event) => {
			if (event.id !== this.id || this.closed) {
				return;
			}
			if (event.type === "message") {
				this.events.dispatchEvent(
					new MessageEvent("message", { data: event.data })
				);
			} else {
				if (event.type === "close") {
					this.closed = true;
					this.unsubscribe();
				}
				this.events.dispatchEvent(new Event(event.type));
			}
		});
		bridge
			.spaceStreamOpen({
				id: this.id,
				spaceId: input.spaceId,
				profileId: input.profileId,
			})
			.catch(() => this.fail());
	}

	addEventListener<K extends keyof WebSocketEventMap>(
		type: K,
		listener: (event: WebSocketEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void;
	addEventListener(
		type: string,
		listener: unknown,
		options?: boolean | AddEventListenerOptions
	) {
		this.events.addEventListener(
			type,
			listener as EventListenerOrEventListenerObject | null,
			options
		);
	}
	removeEventListener<K extends keyof WebSocketEventMap>(
		type: K,
		listener: (event: WebSocketEventMap[K]) => void,
		options?: boolean | EventListenerOptions
	): void;
	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions
	): void;
	removeEventListener(
		type: string,
		listener: unknown,
		options?: boolean | EventListenerOptions
	) {
		this.events.removeEventListener(
			type,
			listener as EventListenerOrEventListenerObject | null,
			options
		);
	}
	send(data: Parameters<WebSocket["send"]>[0]) {
		if (this.closed || data !== SPACE_STREAM_KEEPALIVE_PING) {
			throw new Error("The Space stream only accepts keepalive pings.");
		}
		this.bridge.spaceStreamPing(this.id).catch(() => this.fail());
	}
	close() {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.unsubscribe();
		this.bridge
			.spaceStreamClose(this.id)
			.catch(() => this.events.dispatchEvent(new Event("error")));
		queueMicrotask(() => this.events.dispatchEvent(new Event("close")));
	}
	private fail() {
		if (this.closed) {
			return;
		}
		this.events.dispatchEvent(new Event("error"));
		this.close();
	}
}
