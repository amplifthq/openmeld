/** Validated release metadata owns the key; the CDN serves only immutable artifacts. */
export function desktopDownloadRedirect(origin: string, objectKey: string) {
	return new Response(null, {
		status: 307,
		headers: {
			location: new URL(`/${objectKey}`, origin).href,
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}
