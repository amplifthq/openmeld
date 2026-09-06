/** Preserve hidden items when reordering a filtered section. */
export function moveSidebarItemIds(
	savedIds: readonly string[],
	visibleIds: readonly string[],
	itemId: string,
	beforeId?: string
) {
	const ids = visibleIds.filter((id) => id !== itemId);
	let index = beforeId ? ids.indexOf(beforeId) : -1;
	if (
		beforeId &&
		visibleIds.indexOf(itemId) >= 0 &&
		visibleIds.indexOf(itemId) < visibleIds.indexOf(beforeId)
	) {
		index += 1;
	}
	ids.splice(index < 0 ? ids.length : index, 0, itemId);
	const rendered = new Set([...visibleIds, itemId]);
	ids.push(...savedIds.filter((id) => !rendered.has(id)));
	return ids;
}

export function sortSidebarManual<T>(
	items: readonly T[],
	ids: readonly string[],
	getId: (item: T) => string
) {
	const order = new Map(ids.map((id, index) => [id, index]));
	return [...items].sort(
		(a, b) =>
			(order.get(getId(a)) ?? Number.MAX_SAFE_INTEGER) -
			(order.get(getId(b)) ?? Number.MAX_SAFE_INTEGER)
	);
}
