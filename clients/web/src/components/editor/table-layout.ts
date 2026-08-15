export const DOCUMENT_TABLE_INITIAL_WIDTH = 720;
export const DOCUMENT_TABLE_MIN_COLUMN_WIDTH = 48;

export function getDocumentTableInitialColumnWidth(
	columnCount: number
): number {
	if (columnCount <= 0) {
		return DOCUMENT_TABLE_INITIAL_WIDTH;
	}

	return Math.max(
		DOCUMENT_TABLE_MIN_COLUMN_WIDTH,
		DOCUMENT_TABLE_INITIAL_WIDTH / columnCount
	);
}

export function resolveDocumentTableColumnSizes(
	columnCount: number,
	colSizes: number[]
): number[] {
	const initialColumnWidth = getDocumentTableInitialColumnWidth(columnCount);

	if (colSizes.length > 0) {
		return colSizes.map((colSize) => colSize || initialColumnWidth);
	}

	return Array.from({ length: columnCount }, () => initialColumnWidth);
}
