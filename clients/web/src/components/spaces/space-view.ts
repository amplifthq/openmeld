const SPACE_VIEWS = ["messages", "graph", "files", "tasks", "guide"] as const;

export type SpaceView = (typeof SPACE_VIEWS)[number];

export function getSpaceViewIndex(view: SpaceView): number {
	return SPACE_VIEWS.indexOf(view);
}

export function resolveSpaceView(index: number): SpaceView {
	return SPACE_VIEWS[index] ?? "messages";
}
