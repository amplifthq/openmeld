type ResizeObserverRecord = {
	callback: ResizeObserverCallback;
	observer: ResizeObserver;
	targets: Set<Element>;
};

const resizeObserverRecords = new Set<ResizeObserverRecord>();

// jsdom has no Web Animations engine. Base UI checks for active viewport
// animations before measuring; in this environment there are none.
if (typeof Element.prototype.getAnimations === "undefined") {
	Element.prototype.getAnimations = () => [];
}

class TestResizeObserver implements ResizeObserver {
	readonly #record: ResizeObserverRecord;

	constructor(callback: ResizeObserverCallback) {
		this.#record = {
			callback,
			observer: this,
			targets: new Set(),
		};
		resizeObserverRecords.add(this.#record);
	}

	disconnect() {
		this.#record.targets.clear();
		resizeObserverRecords.delete(this.#record);
	}

	observe(target: Element) {
		this.#record.targets.add(target);
	}

	unobserve(target: Element) {
		this.#record.targets.delete(target);
	}
}

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = TestResizeObserver;
}

if (typeof HTMLElement.prototype.scrollTo === "undefined") {
	Object.defineProperty(HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value(optionsOrX: ScrollToOptions | number, y?: number) {
			if (typeof optionsOrX === "number") {
				this.scrollLeft = optionsOrX;
				this.scrollTop = y ?? 0;
				return;
			}

			if (optionsOrX.left !== undefined) {
				this.scrollLeft = optionsOrX.left;
			}
			if (optionsOrX.top !== undefined) {
				this.scrollTop = optionsOrX.top;
			}
		},
		writable: true,
	});
}

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	configurable: true,
	value: () => null,
	writable: true,
});

export function notifyResizeObservers(target: Element) {
	for (const record of resizeObserverRecords) {
		if (!record.targets.has(target)) {
			continue;
		}

		record.callback(
			[
				{
					contentRect: target.getBoundingClientRect(),
					target,
				} as ResizeObserverEntry,
			],
			record.observer
		);
	}
}
