const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalWebOrigin(value: string | URL): boolean {
	try {
		const url = typeof value === "string" ? new URL(value) : value;
		return (
			LOOPBACK_HOSTNAMES.has(url.hostname) ||
			url.hostname.endsWith(".localhost")
		);
	} catch {
		return false;
	}
}
