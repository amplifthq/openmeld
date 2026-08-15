"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { resizeLengthClampStatic } from "@platejs/resizable";
import {
	getTableColumnCount,
	setTableColSize,
	setTableMarginLeft,
	setTableRowSize,
} from "@platejs/table";
import {
	roundCellSizeToStep,
	TablePlugin,
	TableProvider,
	useCellIndices,
	useOverrideColSize,
	useOverrideMarginLeft,
	useOverrideRowSize,
	useTableCellBorders,
	useTableColSizes,
	useTableElement,
	useTableSelectionDom,
	useTableValue,
} from "@platejs/table/react";
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	KEYS,
	type TTableCellElement,
	type TTableElement,
	type TTableRowElement,
} from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	useEditorPlugin,
	useEditorSelector,
	useElement,
	useElementSelector,
	useFocusedLast,
	useReadOnly,
	useRemoveNodeButton,
	useSelected,
	withHOC,
} from "platejs/react";
import * as React from "react";
import {
	getDocumentTableInitialColumnWidth,
	resolveDocumentTableColumnSizes,
} from "#/components/editor/table-layout";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/editor/ui/popover";

import { Toolbar, ToolbarButton, ToolbarGroup } from "./toolbar";

type TableResizeDirection = "bottom" | "left" | "right";

type TableResizeStartOptions = {
	colIndex: number;
	direction: TableResizeDirection;
	handleKey: string;
	rowIndex: number;
};

type TableResizeDragState = {
	colIndex: number;
	direction: TableResizeDirection;
	initialPosition: number;
	initialSize: number;
	marginLeft: number;
	rowIndex: number;
};

type TableResizeContextValue = {
	disableMarginLeft: boolean;
	clearResizePreview: (handleKey: string) => void;
	setResizePreview: (
		event: React.PointerEvent<HTMLDivElement>,
		options: TableResizeStartOptions
	) => void;
	startResize: (
		event: React.PointerEvent<HTMLDivElement>,
		options: TableResizeStartOptions
	) => void;
};

const TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT = 1200;

const TableResizeContext = React.createContext<TableResizeContextValue | null>(
	null
);

function useTableResizeContext() {
	const context = React.useContext(TableResizeContext);

	if (!context) {
		throw new Error("TableResizeContext is missing");
	}

	return context;
}

function useTableResizeController({
	deferColumnResize,
	dragIndicatorRef,
	hoverIndicatorRef,
	marginLeft,
	controlColumnWidth,
	initialColumnWidth,
	tablePath,
	tableRef,
	wrapperRef,
}: {
	deferColumnResize: boolean;
	dragIndicatorRef: React.RefObject<HTMLDivElement | null>;
	hoverIndicatorRef: React.RefObject<HTMLDivElement | null>;
	marginLeft: number;
	controlColumnWidth: number;
	initialColumnWidth: number;
	tablePath: number[];
	tableRef: React.RefObject<HTMLTableElement | null>;
	wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
	const { editor, getOptions } = useEditorPlugin(TablePlugin);
	const { disableMarginLeft = false, minColumnWidth = 0 } = getOptions();
	const colSizes = useTableColSizes({
		disableOverrides: true,
	});
	const effectiveColSizes = React.useMemo(
		() => colSizes.map((colSize) => colSize || initialColumnWidth),
		[colSizes, initialColumnWidth]
	);
	const effectiveColSizesRef = React.useRef(effectiveColSizes);
	const activeHandleKeyRef = React.useRef<string | null>(null);
	const activeRowElementRef = React.useRef<HTMLTableRowElement | null>(null);
	const cleanupListenersRef = React.useRef<(() => void) | null>(null);
	const marginLeftRef = React.useRef(marginLeft);
	const dragStateRef = React.useRef<TableResizeDragState | null>(null);
	const frozenRowIndicesRef = React.useRef<number[] | null>(null);
	const previewHandleKeyRef = React.useRef<string | null>(null);
	const overrideColSize = useOverrideColSize();
	const overrideMarginLeft = useOverrideMarginLeft();
	const overrideRowSize = useOverrideRowSize();

	React.useEffect(() => {
		effectiveColSizesRef.current = effectiveColSizes;
	}, [effectiveColSizes]);

	React.useEffect(() => {
		marginLeftRef.current = marginLeft;
	}, [marginLeft]);

	const hideDeferredResizeIndicator = React.useCallback(() => {
		const indicator = dragIndicatorRef.current;

		if (!indicator) {
			return;
		}

		indicator.style.display = "none";
		indicator.style.removeProperty("left");
	}, [dragIndicatorRef]);

	const showDeferredResizeIndicator = React.useCallback(
		(offset: number) => {
			const indicator = dragIndicatorRef.current;

			if (!indicator) {
				return;
			}

			indicator.style.display = "block";
			indicator.style.left = `${offset}px`;
		},
		[dragIndicatorRef]
	);

	const hideResizeIndicator = React.useCallback(() => {
		const indicator = hoverIndicatorRef.current;

		if (!indicator) {
			return;
		}

		indicator.style.display = "none";
		indicator.style.removeProperty("left");
	}, [hoverIndicatorRef]);

	const clearFrozenRowHeights = React.useCallback(() => {
		const frozenRowIndices = frozenRowIndicesRef.current;

		if (!frozenRowIndices) {
			return;
		}

		frozenRowIndicesRef.current = null;

		frozenRowIndices.forEach((rowIndex) => {
			overrideRowSize(rowIndex, null);
		});
	}, [overrideRowSize]);

	const freezeRowHeights = React.useCallback(() => {
		const table = tableRef.current;

		if (!table || deferColumnResize) {
			return;
		}

		clearFrozenRowHeights();

		const frozenRowIndices: number[] = [];

		Array.from(table.rows).forEach((row, rowIndex) => {
			const height = row.getBoundingClientRect().height;

			if (!height) {
				return;
			}

			overrideRowSize(rowIndex, height);
			frozenRowIndices.push(rowIndex);
		});

		frozenRowIndicesRef.current = frozenRowIndices;
	}, [clearFrozenRowHeights, deferColumnResize, overrideRowSize, tableRef]);

	const showResizeIndicatorAtOffset = React.useCallback(
		(offset: number) => {
			const indicator = hoverIndicatorRef.current;

			if (!indicator) {
				return;
			}

			indicator.style.display = "block";
			indicator.style.left = `${offset}px`;
		},
		[hoverIndicatorRef]
	);

	const showResizeIndicator = React.useCallback(
		({
			event,
			direction,
		}: Pick<TableResizeStartOptions, "direction"> & {
			event: React.PointerEvent<HTMLDivElement>;
		}) => {
			if (direction === "bottom") {
				return;
			}

			const wrapper = wrapperRef.current;

			if (!wrapper) {
				return;
			}

			const handleRect = event.currentTarget.getBoundingClientRect();
			const wrapperRect = wrapper.getBoundingClientRect();
			const boundaryOffset =
				handleRect.left - wrapperRect.left + handleRect.width / 2;

			showResizeIndicatorAtOffset(boundaryOffset);
		},
		[showResizeIndicatorAtOffset, wrapperRef]
	);

	const setResizePreview = React.useCallback(
		(
			event: React.PointerEvent<HTMLDivElement>,
			options: TableResizeStartOptions
		) => {
			if (activeHandleKeyRef.current) {
				return;
			}

			previewHandleKeyRef.current = options.handleKey;
			showResizeIndicator({ ...options, event });
		},
		[showResizeIndicator]
	);

	const clearResizePreview = React.useCallback(
		(handleKey: string) => {
			if (activeHandleKeyRef.current) {
				return;
			}
			if (previewHandleKeyRef.current !== handleKey) {
				return;
			}

			previewHandleKeyRef.current = null;
			hideResizeIndicator();
		},
		[hideResizeIndicator]
	);

	const commitColSize = React.useCallback(
		(colIndex: number, width: number) => {
			setTableColSize(editor, { colIndex, width }, { at: tablePath });
			setTimeout(() => overrideColSize(colIndex, null), 0);
		},
		[editor, overrideColSize, tablePath]
	);

	const commitRowSize = React.useCallback(
		(rowIndex: number, height: number) => {
			setTableRowSize(editor, { height, rowIndex }, { at: tablePath });
			setTimeout(() => overrideRowSize(rowIndex, null), 0);
		},
		[editor, overrideRowSize, tablePath]
	);

	const commitMarginLeft = React.useCallback(
		(nextMarginLeft: number) => {
			setTableMarginLeft(
				editor,
				{ marginLeft: nextMarginLeft },
				{ at: tablePath }
			);
			setTimeout(() => overrideMarginLeft(null), 0);
		},
		[editor, overrideMarginLeft, tablePath]
	);

	const getColumnBoundaryOffset = React.useCallback(
		(colIndex: number, currentWidth: number) =>
			controlColumnWidth +
			effectiveColSizesRef.current
				.slice(0, colIndex)
				.reduce((total, colSize) => total + colSize, 0) +
			currentWidth,
		[controlColumnWidth]
	);

	const applyResize = React.useCallback(
		(event: PointerEvent, finished: boolean) => {
			const dragState = dragStateRef.current;

			if (!dragState) {
				return;
			}

			const currentPosition =
				dragState.direction === "bottom" ? event.clientY : event.clientX;
			const delta = currentPosition - dragState.initialPosition;

			if (dragState.direction === "bottom") {
				const newHeight = roundCellSizeToStep(
					dragState.initialSize + delta,
					undefined
				);

				if (finished) {
					commitRowSize(dragState.rowIndex, newHeight);
				} else {
					overrideRowSize(dragState.rowIndex, newHeight);
				}

				return;
			}

			if (dragState.direction === "left") {
				const initial =
					effectiveColSizesRef.current[dragState.colIndex] ??
					dragState.initialSize;
				const complement = (width: number) =>
					initial + dragState.marginLeft - width;
				const nextMarginLeft = roundCellSizeToStep(
					resizeLengthClampStatic(dragState.marginLeft + delta, {
						max: complement(minColumnWidth),
						min: 0,
					}),
					undefined
				);
				const nextWidth = complement(nextMarginLeft);

				if (finished) {
					commitMarginLeft(nextMarginLeft);
					commitColSize(dragState.colIndex, nextWidth);
				} else if (deferColumnResize) {
					showDeferredResizeIndicator(
						controlColumnWidth + (nextMarginLeft - dragState.marginLeft)
					);
				} else {
					showResizeIndicatorAtOffset(
						controlColumnWidth + (nextMarginLeft - dragState.marginLeft)
					);
					overrideMarginLeft(nextMarginLeft);
					overrideColSize(dragState.colIndex, nextWidth);
				}

				return;
			}

			const currentInitial =
				effectiveColSizesRef.current[dragState.colIndex] ??
				dragState.initialSize;
			const nextInitial = effectiveColSizesRef.current[dragState.colIndex + 1];
			const complement = (width: number) =>
				currentInitial + nextInitial - width;
			const currentWidth = roundCellSizeToStep(
				resizeLengthClampStatic(currentInitial + delta, {
					max: nextInitial ? complement(minColumnWidth) : undefined,
					min: minColumnWidth,
				}),
				undefined
			);
			const nextWidth = nextInitial ? complement(currentWidth) : undefined;

			if (finished) {
				commitColSize(dragState.colIndex, currentWidth);

				if (nextWidth !== undefined) {
					commitColSize(dragState.colIndex + 1, nextWidth);
				}
			} else if (deferColumnResize) {
				showDeferredResizeIndicator(
					getColumnBoundaryOffset(dragState.colIndex, currentWidth)
				);
			} else {
				showResizeIndicatorAtOffset(
					getColumnBoundaryOffset(dragState.colIndex, currentWidth)
				);
				overrideColSize(dragState.colIndex, currentWidth);

				if (nextWidth !== undefined) {
					overrideColSize(dragState.colIndex + 1, nextWidth);
				}
			}
		},
		[
			commitColSize,
			commitMarginLeft,
			commitRowSize,
			controlColumnWidth,
			deferColumnResize,
			getColumnBoundaryOffset,
			showDeferredResizeIndicator,
			showResizeIndicatorAtOffset,
			minColumnWidth,
			overrideColSize,
			overrideMarginLeft,
			overrideRowSize,
		]
	);

	const stopResize = React.useCallback(() => {
		cleanupListenersRef.current?.();
		cleanupListenersRef.current = null;
		activeHandleKeyRef.current = null;
		previewHandleKeyRef.current = null;
		dragStateRef.current = null;

		if (activeRowElementRef.current) {
			delete activeRowElementRef.current.dataset.tableResizing;
			activeRowElementRef.current = null;
		}

		hideDeferredResizeIndicator();
		hideResizeIndicator();
		clearFrozenRowHeights();
	}, [clearFrozenRowHeights, hideDeferredResizeIndicator, hideResizeIndicator]);

	React.useEffect(() => stopResize, [stopResize]);

	const startResize = React.useCallback(
		(
			event: React.PointerEvent<HTMLDivElement>,
			{ colIndex, direction, handleKey, rowIndex }: TableResizeStartOptions
		) => {
			const rowHeight =
				tableRef.current?.rows.item(rowIndex)?.getBoundingClientRect().height ??
				0;

			dragStateRef.current = {
				colIndex,
				direction,
				initialPosition: direction === "bottom" ? event.clientY : event.clientX,
				initialSize:
					direction === "bottom"
						? rowHeight
						: (effectiveColSizesRef.current[colIndex] ?? initialColumnWidth),
				marginLeft: marginLeftRef.current,
				rowIndex,
			};
			activeHandleKeyRef.current = handleKey;
			previewHandleKeyRef.current = null;

			const rowElement = tableRef.current?.rows.item(rowIndex) ?? null;

			if (
				activeRowElementRef.current &&
				activeRowElementRef.current !== rowElement
			) {
				delete activeRowElementRef.current.dataset.tableResizing;
			}

			activeRowElementRef.current = rowElement;

			if (rowElement) {
				rowElement.dataset.tableResizing = "true";
			}

			cleanupListenersRef.current?.();

			if (direction !== "bottom") {
				freezeRowHeights();
			}

			const handlePointerMove = (pointerEvent: PointerEvent) => {
				applyResize(pointerEvent, false);
			};

			const handlePointerEnd = (pointerEvent: PointerEvent) => {
				applyResize(pointerEvent, true);
				stopResize();
			};

			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerEnd);
			window.addEventListener("pointercancel", handlePointerEnd);

			cleanupListenersRef.current = () => {
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerEnd);
				window.removeEventListener("pointercancel", handlePointerEnd);
			};

			if (deferColumnResize && direction !== "bottom") {
				hideResizeIndicator();
				showDeferredResizeIndicator(
					direction === "left"
						? controlColumnWidth
						: getColumnBoundaryOffset(
								colIndex,
								effectiveColSizesRef.current[colIndex] ?? initialColumnWidth
							)
				);
			} else {
				showResizeIndicator({ direction, event });
			}

			event.preventDefault();
			event.stopPropagation();
		},
		[
			controlColumnWidth,
			deferColumnResize,
			getColumnBoundaryOffset,
			hideResizeIndicator,
			showDeferredResizeIndicator,
			showResizeIndicator,
			stopResize,
			tableRef,
			applyResize,
			freezeRowHeights,
			initialColumnWidth,
		]
	);

	return React.useMemo(
		() => ({
			clearResizePreview,
			disableMarginLeft,
			setResizePreview,
			startResize,
		}),
		[clearResizePreview, disableMarginLeft, setResizePreview, startResize]
	);
}

const TableElementWithProvider = withHOC(
	TableProvider,
	function TableElementContent({
		children,
		...props
	}: PlateElementProps<TTableElement>) {
		const readOnly = useReadOnly();
		const { marginLeft, props: tableProps } = useTableElement();
		const colSizes = useTableColSizes();
		const columnCount = getTableColumnCount(props.element);
		const initialColumnWidth = getDocumentTableInitialColumnWidth(columnCount);
		const controlColumnWidth = 0;
		const dragIndicatorRef = React.useRef<HTMLDivElement>(null);
		const hoverIndicatorRef = React.useRef<HTMLDivElement>(null);
		const deferColumnResize =
			colSizes.length * props.element.children.length >
			TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT;
		const tablePath = useElementSelector(([, path]) => path, [], {
			key: KEYS.table,
		});
		const tableRef = React.useRef<HTMLTableElement>(null);
		const wrapperRef = React.useRef<HTMLDivElement>(null);
		useTableSelectionDom(tableRef);
		const resizeController = useTableResizeController({
			controlColumnWidth,
			deferColumnResize,
			dragIndicatorRef,
			hoverIndicatorRef,
			initialColumnWidth,
			marginLeft,
			tablePath,
			tableRef,
			wrapperRef,
		});
		const resolvedColSizes = React.useMemo(
			() => resolveDocumentTableColumnSizes(columnCount, colSizes),
			[colSizes, columnCount]
		);
		const tableVariableStyle = React.useMemo(() => {
			if (resolvedColSizes.length === 0) {
				return;
			}

			return {
				...Object.fromEntries(
					resolvedColSizes.map((colSize, index) => [
						`--table-col-${index}`,
						`${colSize}px`,
					])
				),
			} as React.CSSProperties;
		}, [resolvedColSizes]);
		const tableStyle = React.useMemo(
			() =>
				({
					width: `${
						resolvedColSizes.reduce((total, colSize) => total + colSize, 0) +
						controlColumnWidth
					}px`,
				}) as React.CSSProperties,
			[controlColumnWidth, resolvedColSizes]
		);

		const content = (
			<PlateElement
				{...props}
				className="overflow-x-auto py-5"
				style={{ paddingLeft: marginLeft }}
			>
				<TableResizeContext.Provider value={resizeController}>
					<div
						className="group/table relative w-fit"
						ref={wrapperRef}
						style={tableVariableStyle}
					>
						<div
							className="pointer-events-none absolute inset-y-0 z-36 hidden w-[3px] -translate-x-[1.5px] bg-ring/70"
							contentEditable={false}
							ref={dragIndicatorRef}
						/>
						<div
							className="pointer-events-none absolute inset-y-0 z-35 hidden w-[3px] -translate-x-[1.5px] bg-ring/80"
							contentEditable={false}
							ref={hoverIndicatorRef}
						/>
						<table
							className={cn(
								"mr-0 ml-px table h-px table-fixed border-collapse",
								"data-[table-selecting=true]:[&_*::selection]:!bg-transparent",
								"data-[table-selecting=true]:[&_*::selection]:!text-inherit",
								"data-[table-selecting=true]:[&_*::-moz-selection]:!bg-transparent",
								"data-[table-selecting=true]:[&_*::-moz-selection]:!text-inherit",
								"data-[table-selecting=true]:[&_*]:!caret-transparent"
							)}
							ref={tableRef}
							style={tableStyle}
							{...tableProps}
						>
							{resolvedColSizes.length > 0 && (
								<colgroup>
									{resolvedColSizes.map((colSize, index) => (
										<col
											key={index}
											style={{
												maxWidth: colSize,
												minWidth: colSize,
												width: colSize,
											}}
										/>
									))}
								</colgroup>
							)}
							<tbody className="min-w-full">{children}</tbody>
						</table>
					</div>
				</TableResizeContext.Provider>
			</PlateElement>
		);

		if (readOnly) {
			return content;
		}

		return <TableFloatingToolbar>{content}</TableFloatingToolbar>;
	}
);

export function TableElement(props: PlateElementProps<TTableElement>) {
	return <TableElementWithProvider {...props} />;
}

function TableFloatingToolbar({
	children,
	...props
}: React.ComponentProps<typeof PopoverContent>) {
	const selected = useSelected();
	const collapsedInside = useEditorSelector(
		(editor) => selected && editor.api.isCollapsed(),
		[selected]
	);
	const isFocusedLast = useFocusedLast();
	const isToolbarOpen = isFocusedLast && collapsedInside;

	return (
		<Popover modal={false} open={isToolbarOpen}>
			<PopoverAnchor asChild>{children}</PopoverAnchor>
			{isToolbarOpen && <TableFloatingToolbarContent {...props} />}
		</Popover>
	);
}

function TableFloatingToolbarContent(
	props: React.ComponentProps<typeof PopoverContent>
) {
	const { tf } = useEditorPlugin(TablePlugin);
	const element = useElement<TTableElement>();
	const { props: buttonProps } = useRemoveNodeButton({ element });

	return (
		<PopoverContent
			asChild
			contentEditable={false}
			onOpenAutoFocus={(e) => e.preventDefault()}
			{...props}
		>
			<Toolbar
				className="flex w-auto max-w-[80vw] flex-row overflow-x-auto rounded-md border bg-popover p-1 shadow-md [scrollbar-width:none] print:hidden [&::-webkit-scrollbar]:hidden"
				contentEditable={false}
			>
				<ToolbarGroup>
					<ToolbarButton
						onClick={() => {
							tf.insert.tableRow({ before: true });
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Insert row before"
					>
						<ArrowUp />
					</ToolbarButton>
					<ToolbarButton
						onClick={() => {
							tf.insert.tableRow();
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Insert row after"
					>
						<ArrowDown />
					</ToolbarButton>
					<ToolbarButton
						onClick={() => {
							tf.remove.tableRow();
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Delete row"
					>
						<XIcon />
					</ToolbarButton>
				</ToolbarGroup>

				<ToolbarGroup>
					<ToolbarButton
						onClick={() => {
							tf.insert.tableColumn({ before: true });
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Insert column before"
					>
						<ArrowLeft />
					</ToolbarButton>
					<ToolbarButton
						onClick={() => {
							tf.insert.tableColumn();
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Insert column after"
					>
						<ArrowRight />
					</ToolbarButton>
					<ToolbarButton
						onClick={() => {
							tf.remove.tableColumn();
						}}
						onMouseDown={(e) => e.preventDefault()}
						tooltip="Delete column"
					>
						<XIcon />
					</ToolbarButton>
				</ToolbarGroup>

				<ToolbarGroup>
					<ToolbarButton tooltip="Delete table" {...buttonProps}>
						<Trash2Icon />
					</ToolbarButton>
				</ToolbarGroup>
			</Toolbar>
		</PopoverContent>
	);
}

export function TableRowElement({
	children,
	...props
}: PlateElementProps<TTableRowElement>) {
	const rowIndex = useElementSelector(([, path]) => path.at(-1) as number, [], {
		key: KEYS.tr,
	});
	const rowSize = useElementSelector(
		([node]) => (node as TTableRowElement).size,
		[],
		{
			key: KEYS.tr,
		}
	);
	const rowSizeOverrides = useTableValue("rowSizeOverrides");
	const rowMinHeight = rowSizeOverrides.get?.(rowIndex) ?? rowSize;

	return (
		<PlateElement
			{...props}
			as="tr"
			className="group/row"
			style={
				{
					...props.style,
					"--tableRowMinHeight": rowMinHeight ? `${rowMinHeight}px` : undefined,
				} as React.CSSProperties
			}
		>
			{children}
		</PlateElement>
	);
}

function useTableCellPresentation(element: TTableCellElement) {
	const { api } = useEditorPlugin(TablePlugin);
	const borders = useTableCellBorders({ element });
	const { col, row } = useCellIndices();

	const colSpan = api.table.getColSpan(element);
	const rowSpan = api.table.getRowSpan(element);
	const width = React.useMemo(() => {
		const terms = Array.from(
			{ length: colSpan },
			(_, offset) => `var(--table-col-${col + offset}, 120px)`
		);

		return terms.length === 1 ? terms[0]! : `calc(${terms.join(" + ")})`;
	}, [col, colSpan]);

	return {
		borders,
		colIndex: col + colSpan - 1,
		colSpan,
		rowIndex: row + rowSpan - 1,
		rowSpan,
		width,
	};
}

export function TableCellElement({
	isHeader,
	...props
}: PlateElementProps<TTableCellElement> & {
	isHeader?: boolean;
}) {
	const readOnly = useReadOnly();
	const element = props.element;

	const { borders, colIndex, colSpan, rowIndex, rowSpan, width } =
		useTableCellPresentation(element);

	return (
		<PlateElement
			{...props}
			as={isHeader ? "th" : "td"}
			attributes={{
				...props.attributes,
				colSpan,
				"data-table-cell-id": element.id,
				rowSpan,
			}}
			className={cn(
				"relative h-full overflow-visible border-none bg-background p-0",
				element.background ? "bg-(--cellBackground)" : "bg-background",
				isHeader && "text-left *:m-0",
				"before:size-full",
				"data-[table-cell-selected=true]:before:z-10",
				"data-[table-cell-selected=true]:before:bg-brand/5",
				"before:absolute before:box-border before:select-none before:content-['']",
				borders.bottom?.size && "before:border-b before:border-b-border",
				borders.right?.size && "before:border-r before:border-r-border",
				borders.left?.size && "before:border-l before:border-l-border",
				borders.top?.size && "before:border-t before:border-t-border"
			)}
			style={
				{
					"--cellBackground": element.background,
					maxWidth: width,
					minWidth: width,
				} as React.CSSProperties
			}
		>
			<div
				className="relative z-20 box-border h-full px-3 py-2"
				style={
					rowSpan === 1
						? { minHeight: "var(--tableRowMinHeight, 0px)" }
						: undefined
				}
			>
				{props.children}
			</div>

			{!readOnly && (
				<TableCellResizeControls colIndex={colIndex} rowIndex={rowIndex} />
			)}
		</PlateElement>
	);
}

export function TableCellHeaderElement(
	props: React.ComponentProps<typeof TableCellElement>
) {
	return <TableCellElement {...props} isHeader />;
}

const TableCellResizeControls = React.memo(function TableCellResizeControls({
	colIndex,
	rowIndex,
}: {
	colIndex: number;
	rowIndex: number;
}) {
	const {
		clearResizePreview,
		disableMarginLeft,
		setResizePreview,
		startResize,
	} = useTableResizeContext();
	const rightHandleKey = `right:${rowIndex}:${colIndex}`;
	const bottomHandleKey = `bottom:${rowIndex}:${colIndex}`;
	const leftHandleKey = `left:${rowIndex}:${colIndex}`;
	const isLeftHandle = colIndex === 0 && !disableMarginLeft;

	return (
		<div
			className="group/resize pointer-events-none absolute inset-0 z-30 select-none"
			contentEditable={false}
			suppressContentEditableWarning={true}
		>
			<div
				className="pointer-events-auto absolute -top-2 -right-1 z-40 h-[calc(100%_+_8px)] w-2 cursor-col-resize touch-none"
				onPointerDown={(event) => {
					startResize(event, {
						colIndex,
						direction: "right",
						handleKey: rightHandleKey,
						rowIndex,
					});
				}}
				onPointerEnter={(event) => {
					setResizePreview(event, {
						colIndex,
						direction: "right",
						handleKey: rightHandleKey,
						rowIndex,
					});
				}}
				onPointerLeave={() => {
					clearResizePreview(rightHandleKey);
				}}
			/>
			<div
				className="pointer-events-auto absolute -bottom-1 left-0 z-40 h-2 w-full cursor-row-resize touch-none"
				onPointerDown={(event) => {
					startResize(event, {
						colIndex,
						direction: "bottom",
						handleKey: bottomHandleKey,
						rowIndex,
					});
				}}
				onPointerEnter={(event) => {
					setResizePreview(event, {
						colIndex,
						direction: "bottom",
						handleKey: bottomHandleKey,
						rowIndex,
					});
				}}
				onPointerLeave={() => {
					clearResizePreview(bottomHandleKey);
				}}
			/>
			{isLeftHandle && (
				<div
					className="pointer-events-auto absolute top-0 -left-1 z-40 h-full w-2 cursor-col-resize touch-none"
					onPointerDown={(event) => {
						startResize(event, {
							colIndex,
							direction: "left",
							handleKey: leftHandleKey,
							rowIndex,
						});
					}}
					onPointerEnter={(event) => {
						setResizePreview(event, {
							colIndex,
							direction: "left",
							handleKey: leftHandleKey,
							rowIndex,
						});
					}}
					onPointerLeave={() => {
						clearResizePreview(leftHandleKey);
					}}
				/>
			)}
		</div>
	);
});

TableCellResizeControls.displayName = "TableCellResizeControls";
