"use client";

import {
	TableCellHeaderPlugin,
	TableCellPlugin,
	TablePlugin,
	TableRowPlugin,
} from "@platejs/table/react";
import {
	DOCUMENT_TABLE_INITIAL_WIDTH,
	DOCUMENT_TABLE_MIN_COLUMN_WIDTH,
} from "#/components/editor/table-layout";
import {
	TableCellElement,
	TableCellHeaderElement,
	TableElement,
	TableRowElement,
} from "#/components/editor/ui/table-node";

export const TableKit = [
	TablePlugin.configure({
		node: { component: TableElement },
		options: {
			initialTableWidth: DOCUMENT_TABLE_INITIAL_WIDTH,
			minColumnWidth: DOCUMENT_TABLE_MIN_COLUMN_WIDTH,
		},
	}),
	TableRowPlugin.withComponent(TableRowElement),
	TableCellPlugin.withComponent(TableCellElement),
	TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
];
