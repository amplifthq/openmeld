"use client";

import { useEffect, useState } from "react";
import { CsvViewer } from "./csv-viewer";

export function CsvFilePreview({
	className,
	url,
}: {
	className?: string;
	url: string;
}) {
	const [result, setResult] = useState<
		| { url: string; data: string; error?: never }
		| { url: string; error: string; data?: never }
		| null
	>(null);
	useEffect(() => {
		const controller = new AbortController();
		setResult(null);
		void fetch(url, { signal: controller.signal })
			.then((response) => {
				if (!response.ok) throw new Error("CSV preview couldn't be loaded.");
				return response.text();
			})
			.then((data) => setResult({ url, data }))
			.catch((error: unknown) => {
				if (!controller.signal.aborted) {
					setResult({
						url,
						error:
							error instanceof Error
							? error.message
							: "CSV preview couldn't be loaded.",
					});
				}
			});
		return () => controller.abort();
	}, [url]);
	if (!result || result.url !== url) {
		return (
			<div className="grid size-full place-items-center text-muted-foreground text-sm">
				Loading CSV preview…
			</div>
		);
	}
	if (result.error) {
		return (
			<div className="grid size-full place-items-center text-destructive text-sm">
				{result.error}
			</div>
		);
	}
	return (
		<CsvViewer
			className={className}
			data={result.data}
			search
			showUpload={false}
		/>
	);
}
