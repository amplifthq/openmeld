const SPACE_VIEWS = ["messages", "graph", "files", "tasks", "guide"] as const;

export type SpaceView = (typeof SPACE_VIEWS)[number];

export function getSpaceViewIndex(view: SpaceView): number {
	return SPACE_VIEWS.indexOf(view);
}

export function resolveSpaceView(index: number): SpaceView {
	return SPACE_VIEWS[index] ?? "messages";
}

/** Views a Center Agent DM can show; it has no Guide tab. */
export type CenterAgentSpaceView = Exclude<SpaceView, "guide">;

export function toCenterAgentSpaceView(view: SpaceView): CenterAgentSpaceView {
	return view === "guide" ? "messages" : view;
}
