import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { useLayoutEffect, useRef } from "react";

// Both conversation surfaces use the same visibility and dwell policy. The
// server's scoped read-through watermark remains the only durable read owner.
export function SpaceMessageReadObserver(input: {
	unreadTargets: readonly SpaceInboxUnreadTarget[];
	onViewedThroughTs?: (timestamp: number) => Promise<void> | void;
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
		let persistedThrough = 0;
		let candidate = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let retryAttempt = 0;
		let inFlight = false;
		function visibleThrough() {
			if (
				document.visibilityState !== "visible" ||
				viewport?.closest('[inert], [aria-hidden="true"]') ||
				!current.current.onViewedThroughTs ||
				!viewport
			) {
				return 0;
			}
			return resolveVisibleReadThrough(
				viewport,
				current.current,
				persistedThrough
			);
		}
		function measure() {
			if (!active) {
				return;
			}
			const next = visibleThrough();
			if (next === candidate && (timer !== undefined || inFlight)) {
				return;
			}
			clearTimeout(timer);
			timer = undefined;
			candidate = next;
			if (inFlight || next <= persistedThrough) {
				return;
			}
			timer = setTimeout(
				async () => {
					timer = undefined;
					if (!active || visibleThrough() < next) {
						measure();
						return;
					}
					inFlight = true;
					try {
						await current.current.onViewedThroughTs?.(next);
						persistedThrough = Math.max(persistedThrough, next);
						retryAttempt = 0;
					} catch (error) {
						console.warn(
							"Failed to persist the Space Inbox read position.",
							error
						);
						retryAttempt += 1;
					} finally {
						inFlight = false;
						measure();
					}
				},
				150 + Math.min(retryAttempt, 4) * 200
			);
		}
		measureRef.current = measure;
		viewport.addEventListener("scroll", measure, { passive: true });
		document.addEventListener("visibilitychange", measure);
		window.addEventListener("resize", measure);
		const resize = new ResizeObserver(measure);
		resize.observe(viewport);
		for (const child of viewport.children) {
			resize.observe(child);
		}
		measure();
		return () => {
			active = false;
			clearTimeout(timer);
			resize.disconnect();
			viewport.removeEventListener("scroll", measure);
			document.removeEventListener("visibilitychange", measure);
			window.removeEventListener("resize", measure);
			measureRef.current = () => undefined;
		};
	}, []);
	return <span aria-hidden="true" className="hidden" ref={markerRef} />;
}

function resolveVisibleReadThrough(
	viewport: HTMLElement,
	input: {
		unreadTargets: readonly SpaceInboxUnreadTarget[];
	},
	persistedThrough: number
): number {
	const bounds = viewport.getBoundingClientRect();
	const top = Math.max(bounds.top, 0);
	const bottom = Math.min(bounds.bottom, window.innerHeight);
	if (bounds.width <= 0 || bottom <= top) {
		return 0;
	}
	const messages = new Map(
		input.unreadTargets.map((target) => [target.signalId, target.occurredAtMs])
	);
	const viewed = new Set<string>();
	const candidates: number[] = [];
	for (const element of viewport.querySelectorAll<HTMLElement>(
		"[data-message-row-id]"
	)) {
		const id = element.dataset.messageRowId ?? "";
		const timestamp = messages.get(id);
		if (timestamp === undefined) {
			continue;
		}
		const rect = element.getBoundingClientRect();
		// A header plus the beginning of the body must have entered the
		// viewport. A jump past a message is not evidence that it was read.
		if (
			rect.width > 0 &&
			rect.height > 0 &&
			rect.top >= top &&
			rect.right > Math.max(bounds.left, 0) &&
			rect.left < Math.min(bounds.right, window.innerWidth) &&
			rect.top + Math.min(80, rect.height) <= bottom &&
			isMessageBeginningUncovered(element, rect)
		) {
			viewed.add(id);
			candidates.push(timestamp);
		}
	}
	// A later reaction on a visible old message must not sweep away an
	// unseen message farther down or outside the loaded history window.
	let firstUnseen = Number.POSITIVE_INFINITY;
	for (const target of input.unreadTargets) {
		if (
			target.occurredAtMs > persistedThrough &&
			!viewed.has(target.signalId)
		) {
			firstUnseen = Math.min(firstUnseen, target.occurredAtMs);
		}
	}
	return Math.max(
		0,
		...candidates.filter((timestamp) => timestamp < firstUnseen)
	);
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
