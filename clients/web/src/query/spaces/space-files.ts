export const spaceFileQueryKeys = {
	all: ["space-files"] as const,
	space: (spaceId: string) => [...spaceFileQueryKeys.all, spaceId] as const,
	folder: (
		spaceId: string,
		parentId: string | null,
		view: "active" | "trash" = "active"
	) =>
		[...spaceFileQueryKeys.space(spaceId), "folder", view, parentId] as const,
	content: (spaceId: string, fileId: string, revision: number) =>
		[
			...spaceFileQueryKeys.space(spaceId),
			"content",
			fileId,
			revision,
		] as const,
	revisions: (spaceId: string, fileId: string) =>
		[...spaceFileQueryKeys.space(spaceId), "revisions", fileId] as const,
};
