// The component fixture has no SSR server. Keep browser implementations of
// TanStack's isomorphic functions; an attempted server RPC must fail visibly.
export function createIsomorphicFn() {
	return {
		client: (fn: (...args: unknown[]) => unknown) => ({ server: () => fn }),
	};
}

export function createServerFn() {
	const builder = {
		inputValidator: () => builder,
		middleware: () => builder,
		handler: () => () => {
			throw new Error("Server RPC is outside this editor fixture");
		},
	};
	return builder;
}
