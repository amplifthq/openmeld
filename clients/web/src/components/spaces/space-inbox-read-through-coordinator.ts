type ReadThroughRequest = {
	threadRootSignalId?: string;
	throughOccurredAtMs: number;
};

type Waiter = {
	reject: (error: unknown) => void;
	resolve: () => void;
	throughOccurredAtMs: number;
};

type ScopeState = {
	pendingThroughOccurredAtMs: number;
	running: boolean;
	threadRootSignalId?: string;
	waiters: Waiter[];
};

export function createSpaceInboxReadThroughCoordinator(
	write: (request: ReadThroughRequest) => Promise<void>
): (request: ReadThroughRequest) => Promise<void> {
	const states = new Map<string, ScopeState>();

	return (request) => {
		const scopeKey = request.threadRootSignalId ?? "main";
		const state = states.get(scopeKey) ?? {
			pendingThroughOccurredAtMs: 0,
			running: false,
			...(request.threadRootSignalId
				? { threadRootSignalId: request.threadRootSignalId }
				: {}),
			waiters: [],
		};
		states.set(scopeKey, state);
		state.pendingThroughOccurredAtMs = Math.max(
			state.pendingThroughOccurredAtMs,
			request.throughOccurredAtMs
		);

		const promise = new Promise<void>((resolve, reject) => {
			state.waiters.push({
				reject,
				resolve,
				throughOccurredAtMs: request.throughOccurredAtMs,
			});
		});
		if (!state.running) {
			state.running = true;
			drainScope({ scopeKey, state, states, write }).catch((error) => {
				console.error(
					"Failed to coordinate Space Inbox read positions.",
					error
				);
			});
		}
		return promise;
	};
}

async function drainScope(input: {
	scopeKey: string;
	state: ScopeState;
	states: Map<string, ScopeState>;
	write: (request: ReadThroughRequest) => Promise<void>;
}): Promise<void> {
	while (input.state.pendingThroughOccurredAtMs > 0) {
		const throughOccurredAtMs = input.state.pendingThroughOccurredAtMs;
		input.state.pendingThroughOccurredAtMs = 0;
		try {
			await input.write({
				...(input.state.threadRootSignalId
					? { threadRootSignalId: input.state.threadRootSignalId }
					: {}),
				throughOccurredAtMs,
			});
			settleWaiters(input.state, throughOccurredAtMs);
		} catch (error) {
			settleWaiters(input.state, throughOccurredAtMs, error);
		}
	}
	input.state.running = false;
	if (input.state.waiters.length === 0) {
		input.states.delete(input.scopeKey);
	}
}

function settleWaiters(
	state: ScopeState,
	throughOccurredAtMs: number,
	error?: unknown
): void {
	const settled = state.waiters.filter(
		(waiter) => waiter.throughOccurredAtMs <= throughOccurredAtMs
	);
	state.waiters = state.waiters.filter(
		(waiter) => waiter.throughOccurredAtMs > throughOccurredAtMs
	);
	for (const waiter of settled) {
		if (error === undefined) {
			waiter.resolve();
		} else {
			waiter.reject(error);
		}
	}
}
