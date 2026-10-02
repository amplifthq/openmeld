"use client";

import { useTheme } from "next-themes";
import { lazy, type ReactNode, useEffect, useState } from "react";

const DocxViewer = lazy(() =>
	import("#/components/extend/docx-viewer").then((module) => ({
		default: module.DocxViewerPreview,
	}))
);
const PptxViewer = lazy(() =>
	import("#/components/extend/pptx-viewer").then((module) => ({
		default: module.PptxViewerPreview,
	}))
);
const XlsxViewer = lazy(() =>
	import("#/components/extend/xlsx-viewer").then((module) => ({
		default: module.XlsxViewerPreview,
	}))
);

export function OfficeFileViewer(input: {
	className?: string;
	fileName: string;
	kind: "docx" | "pptx" | "xlsx";
	showToolbar: boolean;
	toolbarActions?: ReactNode;
	url: string;
}) {
	const { resolvedTheme } = useTheme();
	const [isDark, setIsDark] = useState(resolvedTheme === "dark");
	useEffect(() => setIsDark(resolvedTheme === "dark"), [resolvedTheme]);
	const common = {
		className: input.className,
		fileName: input.fileName,
		showDownload: false,
		showToolbar: input.showToolbar,
		showUpload: false,
		src: input.url,
		toolbarActions: input.toolbarActions,
	};
	switch (input.kind) {
		case "docx":
			return <DocxViewer {...common} isDark={isDark} onIsDarkChange={setIsDark} />;
		case "xlsx":
			return <XlsxViewer {...common} isDark={isDark} onIsDarkChange={setIsDark} />;
		case "pptx":
			return <PptxViewer {...common} />;
	}
}
