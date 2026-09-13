type Bounds = { x: number; y: number; width: number; height: number };
/** Keep new windows beside existing work rather than covering its composer. */
export function findDeskPlacement(
	start: { x: number; y: number },
	size: { width: number; height: number },
	occupied: readonly Bounds[]
) {
	let point = { ...start };
	for (let attempt = 0; attempt <= occupied.length; attempt++) {
		const collision = occupied.find(
			(rect) =>
				point.x < rect.x + rect.width + 24 &&
				point.x + size.width + 24 > rect.x &&
				point.y < rect.y + rect.height + 24 &&
				point.y + size.height + 24 > rect.y
		);
		if (!collision) {
			return point;
		}
		point = { x: collision.x + collision.width + 32, y: point.y };
	}
	return point;
}
