import type { SpaceFileContent } from "@openmeld/api-client";
import type { QueryClient } from "@tanstack/react-query";

export type CachedSpaceFileContent = Omit<SpaceFileContent, "bytes"> & {
	bytes: ArrayBuffer | Blob;
	mediaPreview?: SpaceFileMediaResource;
};

/** A display handle, not a second byte cache. Query data owns immutable bytes. */
export class SpaceFileMediaResource {
	readonly identity: string;
	readonly spaceId: string;
	readonly originalUrl: string;
	private url: string | null;
	private owners = 1;
	private creatorReleased = false;
	private readonly listeners = new Set<() => void>();
	private readonly onReleased: () => void;

	constructor(input: {
		blob: Blob;
		identity: string;
		spaceId: string;
		onReleased: () => void;
	}) {
		this.identity = input.identity;
		this.spaceId = input.spaceId;
		this.originalUrl = URL.createObjectURL(input.blob);
		this.url = this.originalUrl;
		this.onReleased = input.onReleased;
	}

	getSnapshot = (): string | null => this.url;
	getServerSnapshot = (): null => null;
	get ownerCount(): number {
		return this.owners;
	}

	retain = (): (() => void) => {
		this.owners += 1;
		let released = false;
		return () => {
			if (!released) {
				released = true;
				this.releaseOwner();
			}
		};
	};

	/** The creator hands its one lease to the composer or the Query cache. */
	release = (): void => {
		if (!this.creatorReleased) {
			this.creatorReleased = true;
			this.releaseOwner();
		}
	};

	private releaseOwner(): void {
		this.owners = Math.max(0, this.owners - 1);
		if (this.owners === 0) {
			this.revoke();
		}
		this.onReleased();
	}

	subscribe = (listener: () => void): (() => void) => {
		const release = this.retain();
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
			release();
		};
	};

	/** Authorization loss wins even while a viewer still holds a lease. */
	revoke(): void {
		if (this.url === null) {
			return;
		}
		URL.revokeObjectURL(this.url);
		this.url = null;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

const MAX_IDLE_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_IDLE_MEDIA_COUNT = 32;
const owners = new WeakMap<QueryClient, ReturnType<typeof createOwner>>();

function readPreview(data: unknown): SpaceFileMediaResource | undefined {
	if (data && typeof data === "object" && "mediaPreview" in data) {
		return data.mediaPreview instanceof SpaceFileMediaResource
			? data.mediaPreview
			: undefined;
	}
	return undefined;
}

function createOwner(client: QueryClient) {
	const revocationListeners = new Set<
		(scope: { spaceId?: string; fileId?: string }) => void
	>();
	function notifyRevocation(scope: { spaceId?: string; fileId?: string }) {
		for (const listener of revocationListeners) {
			listener(scope);
		}
	}
	// Seeds created before their first observer get the same binary GC policy.
	client.setQueryDefaults(["space-files"], { gcTime: 5 * 60 * 1000 });
	const resources = new Map<string, SpaceFileMediaResource>();
	const cached = new Map<
		string,
		{ resource: SpaceFileMediaResource; release: () => void }
	>();
	const awaitingAdmission = new Set<SpaceFileMediaResource>();
	let generation = 0;
	let pruning = false;
	let pruneQueued = false;
	function schedulePrune() {
		if (pruneQueued) {
			return;
		}
		pruneQueued = true;
		// Reconcile cache and consumer leases before applying the idle budget.
		queueMicrotask(() => {
			pruneQueued = false;
			prune();
		});
	}
	function prune() {
		if (pruning) {
			return;
		}
		pruning = true;
		try {
			const idle = client
				.getQueryCache()
				.getAll()
				.filter((query) => {
					const resource = readPreview(query.state.data);
					return (
						resource?.ownerCount === 1 &&
						query.getObserversCount() === 0 &&
						query.state.fetchStatus === "idle"
					);
				})
				.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
			let bytes = 0;
			let count = 0;
			for (const query of idle) {
				const data = query.state.data as CachedSpaceFileContent;
				bytes +=
					data.bytes instanceof Blob ? data.bytes.size : data.bytes.byteLength;
				count += 1;
				if (bytes > MAX_IDLE_MEDIA_BYTES || count > MAX_IDLE_MEDIA_COUNT) {
					client.getQueryCache().remove(query);
				}
			}
		} finally {
			pruning = false;
		}
	}
	client.getQueryCache().subscribe((event) => {
		const previous = cached.get(event.query.queryHash);
		const next =
			event.type === "removed"
				? undefined
				: readPreview(event.query.state.data);
		if (previous?.resource !== next) {
			// Retain first: replacing query data must not revoke a shared handle.
			if (next) {
				cached.set(event.query.queryHash, {
					resource: next,
					release: next.retain(),
				});
			} else {
				cached.delete(event.query.queryHash);
			}
			previous?.release();
			if (next && awaitingAdmission.delete(next)) {
				next.release();
			}
		}
		if (event.type === "observerRemoved") {
			schedulePrune();
		}
	});
	return {
		get generation() {
			return generation;
		},
		create(
			blob: Blob,
			spaceId: string,
			identity: string,
			admissionSignal?: AbortSignal
		) {
			const resource = new SpaceFileMediaResource({
				blob,
				spaceId,
				identity,
				onReleased: () => {
					if (resource.ownerCount === 0) {
						resources.delete(resource.originalUrl);
					}
					schedulePrune();
				},
			});
			resources.set(resource.originalUrl, resource);
			if (admissionSignal) {
				awaitingAdmission.add(resource);
				admissionSignal.addEventListener(
					"abort",
					() => {
						if (awaitingAdmission.delete(resource)) {
							resource.release();
						}
					},
					{ once: true }
				);
			}
			return resource;
		},
		find: (url: string) => resources.get(url),
		subscribeRevocation(
			listener: (scope: { spaceId?: string; fileId?: string }) => void
		) {
			revocationListeners.add(listener);
			return () => {
				revocationListeners.delete(listener);
			};
		},
		notifyRevocation,
		clear(spaceId?: string) {
			notifyRevocation({ spaceId });
			if (spaceId === undefined) {
				generation += 1;
			}
			for (const resource of resources.values()) {
				if (spaceId === undefined || resource.spaceId === spaceId) {
					resource.revoke();
					if (awaitingAdmission.delete(resource)) {
						resource.release();
					}
				}
			}
		},
	};
}

export function spaceFileMediaResources(client: QueryClient) {
	let owner = owners.get(client);
	if (!owner) {
		owner = createOwner(client);
		owners.set(client, owner);
	}
	return owner;
}

/** Synchronous pixel revocation precedes asynchronous persistence cleanup. */
export function clearSpaceFileMediaResources(
	client: QueryClient,
	spaceId?: string
): void {
	owners.get(client)?.clear(spaceId);
	const queryKey =
		spaceId === undefined ? ["space-files"] : ["space-files", spaceId];
	client
		.cancelQueries({ queryKey }, { revert: false })
		.catch((error: unknown) => {
			console.error("Could not cancel a revoked file read.", { error });
		});
	client.removeQueries({ queryKey });
}

/** Authoritative deletion/denial revokes this file without evicting its siblings. */
export function clearSpaceFileMedia(
	client: QueryClient,
	spaceId: string,
	fileId: string
): void {
	owners.get(client)?.notifyRevocation({ spaceId, fileId });
	const queryKey = ["space-files", spaceId, "content", fileId];
	for (const query of client.getQueryCache().findAll({ queryKey })) {
		readPreview(query.state.data)?.revoke();
	}
	client
		.cancelQueries({ queryKey }, { revert: false })
		.catch((error: unknown) => {
			console.error("Could not cancel a revoked media read.", { error });
		});
	client.removeQueries({ queryKey });
}
