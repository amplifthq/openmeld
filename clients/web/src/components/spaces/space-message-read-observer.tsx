import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useLayoutEffect, useRef } from "react";
import { isInboxDocumentFocused } from "#/lib/inbox/desktop-notifications";

// Acknowledges rendered updates, including out-of-order reading. A short batch
// accumulates evidence during scrolling; leaving the viewport does not erase it.
export function SpaceMessageReadObserver(input: {
	unreadTargets: readonly SpaceInboxUnreadTarget[];
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
}) {
	const markerRef = useRef<HTMLSpanElement>(null);
	const current = useRef(input);
	const measureRef = useRef<() => void>(() => undefined);
	useLayoutEffect(() => {
		current.current = input;
		measureRef.current();
	});
	useLayoutEffect(() => {
		const viewport = markerRef.current?.parentElement;
		if (!viewport) {
			return;
		}
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let frame: number | undefined;
		let inFlight = false;
		let retryAttempt = 0;
		const pending = new Map<string, SpaceInboxUnreadTarget>();
		const acknowledged = new Set<string>();
		const key = (t: SpaceInboxUnreadTarget) =>
			`${t.itemId ?? t.signalId}:${t.occurredAtMs}`;
		const readable = () =>
			isInboxDocumentFocused() &&
			!viewport.closest('[inert], [aria-hidden="true"]') &&
			!!current.current.onViewedUpdates;
		async function flush() {
			timer = undefined;
			if (!(active && readable())) {
				pending.clear();
				return;
			}
			if (inFlight || pending.size === 0) {
				return;
			}
			const batch = [...pending.values()];
			pending.clear();
			inFlight = true;
			try {
				await current.current.onViewedUpdates?.(batch);
				for (const target of batch) {
					acknowledged.add(key(target));
				}
				retryAttempt = 0;
			} catch (error) {
				// Re-measure on retry. Failed writes never become local read truth.
				console.warn("Could not mark visible updates as read.", error);
				retryAttempt += 1;
			} finally {
				inFlight = false;
				if (active) {
					measure();
				}
			}
		}
		function measure() {
			if (!(active && viewport)) {
				return;
			}
			if (!readable()) {
				pending.clear();
				clearTimeout(timer);
				timer = undefined;
				return;
			}
			for (const target of visibleTargets(
				viewport,
				current.current.unreadTargets
			)) {
				if (!acknowledged.has(key(target))) {
					pending.set(key(target), target);
				}
			}
			if (!inFlight && pending.size && timer === undefined) {
				timer = setTimeout(flush, 50 + Math.min(retryAttempt, 4) * 250);
			}
		}
		const requestMeasure = () => {
			if (frame !== undefined) {
				cancelAnimationFrame(frame);
			}
			frame = requestAnimationFrame(() => {
				frame = undefined;
				measure();
			});
		};
		measureRef.current = requestMeasure;
		viewport.addEventListener("scroll", measure, { passive: true });
		document.addEventListener("visibilitychange", measure);
		window.addEventListener("resize", requestMeasure);
		window.addEventListener("focus", requestMeasure);
		window.addEventListener("blur", measure);
		const resize = new ResizeObserver(requestMeasure);
		resize.observe(viewport);
		for (const child of viewport.children) {
			resize.observe(child);
		}
		requestMeasure();
		return () => {
			active = false;
			clearTimeout(timer);
			if (frame !== undefined) {
				cancelAnimationFrame(frame);
			}
			resize.disconnect();
			viewport.removeEventListener("scroll", measure);
			document.removeEventListener("visibilitychange", measure);
			window.removeEventListener("resize", requestMeasure);
			window.removeEventListener("focus", requestMeasure);
			window.removeEventListener("blur", measure);
			measureRef.current = () => undefined;
		};
	}, []);
	return <span aria-hidden="true" className="hidden" ref={markerRef} />;
}

function visibleTargets(
	viewport: HTMLElement,
	targets: readonly SpaceInboxUnreadTarget[]
) {
	const bounds = viewport.getBoundingClientRect();
	const top = Math.max(bounds.top, 0);
	const bottom = Math.min(bounds.bottom, window.innerHeight);
	if (bounds.width <= 0 || bottom <= top) {
		return [];
	}
	const viewed = new Set<string>();
	for (const element of viewport.querySelectorAll<HTMLElement>(
		"[data-message-row-id]"
	)) {
		const rect = element.getBoundingClientRect();
		if (
			rect.width > 0 &&
			rect.height > 0 &&
			rect.top >= top &&
			rect.right > Math.max(bounds.left, 0) &&
			rect.left < Math.min(bounds.right, window.innerWidth) &&
			rect.top + Math.min(80, rect.height) <= bottom &&
			isMessageBeginningUncovered(element, rect)
		) {
			viewed.add(element.dataset.messageRowId ?? "");
		}
	}
	return targets.filter((target) => viewed.has(target.signalId));
}

function isMessageBeginningUncovered(
	element: HTMLElement,
	rect: DOMRect
): boolean {
	const left = Math.max(0, rect.left);
	const width = Math.min(window.innerWidth, rect.right) - left;
	// A small floating date/unread pill can cover the center while the
	// message beginning remains readable on either side. A modal covers both.
	return [0.25, 0.75].some((fraction) =>
		[Math.min(8, rect.height / 2), Math.min(79, rect.height - 1)].every(
			(offset) => {
				const x = left + width * fraction;
				const hit = document.elementFromPoint(x, rect.top + offset);
				return hit !== null && element.contains(hit);
			}
		)
	);
}
