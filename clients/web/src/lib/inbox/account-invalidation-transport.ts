import type { DesktopAccountStreamBridge } from "@openmeld/schemas";

export type AccountInvalidationTransport = Pick<
	WebSocket,
	"addEventListener" | "removeEventListener" | "send" | "close"
>;

export function createAccountInvalidationTransport(input: {
	organizationId: string;
	desktop: DesktopAccountStreamBridge | null;
}): AccountInvalidationTransport | null {
	if (input.desktop) {
		const bridge = input.desktop;
		if (
			!(
				bridge.accountStreamOpen &&
				bridge.accountStreamClose &&
				bridge.accountStreamPing &&
				bridge.onAccountStream
			)
		) {
			return null;
		}
		return new DesktopAccountInvalidationTransport(
			bridge as Required<DesktopAccountStreamBridge>,
			input.organizationId
		);
	}
	const url = new URL(
		"/v1/account/invalidation-stream",
		window.location.origin
	);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("organizationId", input.organizationId);
	return new WebSocket(url);
}

class DesktopAccountInvalidationTransport
	implements AccountInvalidationTransport
{
	private readonly id = crypto.randomUUID();
	private readonly events = new EventTarget();
	private readonly unsubscribe: () => void;
	private readonly bridge: Required<DesktopAccountStreamBridge>;
	private closed = false;

	constructor(
		bridge: Required<DesktopAccountStreamBridge>,
		organizationId: string
	) {
		this.bridge = bridge;
		this.unsubscribe = bridge.onAccountStream((event) => {
			if (this.closed || event.id !== this.id) {
				return;
			}
			if (event.type === "message") {
				this.events.dispatchEvent(
					new MessageEvent("message", { data: event.data })
				);
			} else {
				this.events.dispatchEvent(new Event(event.type));
				if (event.type === "close") {
					this.closed = true;
					this.unsubscribe();
				}
			}
		});
		bridge
			.accountStreamOpen({ id: this.id, organizationId })
			.catch(() => this.fail());
	}

	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions
	): void {
		this.events.addEventListener(type, listener, options);
	}

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions
	): void {
		this.events.removeEventListener(type, listener, options);
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (this.closed || data !== "ping") {
			throw new Error("Account stream only accepts keepalive pings.");
		}
		this.bridge.accountStreamPing(this.id).catch(() => this.fail());
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.unsubscribe();
		this.bridge.accountStreamClose(this.id).catch(() => undefined);
		queueMicrotask(() => this.events.dispatchEvent(new Event("close")));
	}

	private fail(): void {
		if (this.closed) {
			return;
		}
		this.events.dispatchEvent(new Event("error"));
		this.close();
	}
}
