// A constructor only submits a request. Even `show` acknowledges browser
// presentation, not that the operating system displayed a banner or a person saw it.
export const BROWSER_NOTIFICATION_ACK_TIMEOUT_MS = 10_000;

type BrowserNotificationAcknowledgement =
	| "shown"
	| "failed"
	| "unconfirmed"
	| "cancelled";

export function waitForBrowserNotificationAcknowledgement(
	notification: Notification,
	signal?: AbortSignal
): Promise<BrowserNotificationAcknowledgement> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: BrowserNotificationAcknowledgement) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			notification.onshow = null;
			notification.onerror = null;
			notification.onclose = null;
			signal?.removeEventListener("abort", cancel);
			if (result !== "shown") {
				notification.onclick = null;
				notification.close();
			}
			resolve(result);
		};
		const cancel = () => finish("cancelled");
		// Bound an unacknowledged platform request, not an execution or proof of
		// failure. Closing the attempt prevents late events from settling it.
		const timer = setTimeout(
			() => finish("unconfirmed"),
			BROWSER_NOTIFICATION_ACK_TIMEOUT_MS
		);
		notification.onshow = () => finish("shown");
		notification.onerror = () => finish("failed");
		notification.onclose = () => finish("unconfirmed");
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) {
			cancel();
		}
	});
}
