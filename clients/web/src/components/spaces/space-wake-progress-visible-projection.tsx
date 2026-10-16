"use client";

import type { WakeProgressItem } from "@openmeld/schemas/types";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { recordReactUpdate } from "#/lib/observability/react-update-trace";

type VisibleWakeProgressSnapshot = readonly WakeProgressItem[] | null;

type ConversationScope = {
	profileId: string | undefined;
	spaceId: string | undefined;
};
type Publication = { items: readonly WakeProgressItem[] };
type ProjectionState = ConversationScope & {
	activation: symbol;
	publication: Publication | null;
};
type PublishVisibleWakeProgress = (
	items: readonly WakeProgressItem[]
) => () => void;

const VisibleWakeProgressSnapshotContext = createContext<
	(ConversationScope & { items: VisibleWakeProgressSnapshot }) | null
>(null);
const PublishVisibleWakeProgressContext = createContext<
	(ConversationScope & { publish: PublishVisibleWakeProgress }) | null
>(null);

function sameScope(left: ConversationScope, right: ConversationScope): boolean {
	return left.profileId === right.profileId && left.spaceId === right.spaceId;
}

export function SpaceWakeProgressVisibleProjectionProvider(
	input: {
		children: ReactNode;
	} & ConversationScope
) {
	const { profileId, spaceId } = input;
	const [state, setState] = useState<ProjectionState>(() => ({
		profileId,
		spaceId,
		activation: Symbol("conversation visit"),
		publication: null,
	}));
	// Reset only the read projection when the conversation changes. Keep the
	// shell mounted, and reject callbacks from an earlier visit (including A-B-A).
	const current = sameScope(state, input)
		? state
		: {
				profileId,
				spaceId,
				activation: Symbol("conversation visit"),
				publication: null,
			};
	if (current !== state) {
		setState(current);
	}
	const activation = current.activation;
	const publish = useCallback<PublishVisibleWakeProgress>(
		(items) => {
			const publication = { items };
			setState((previous) =>
				previous.activation === activation
					? { ...previous, publication }
					: previous
			);
			return () => {
				setState((previous) =>
					previous.activation === activation &&
					previous.publication === publication
						? { ...previous, publication: null }
						: previous
				);
			};
		},
		[activation]
	);
	const publisher = useMemo(
		() => ({ profileId, spaceId, publish }),
		[profileId, spaceId, publish]
	);
	const items = current.publication?.items ?? null;
	const snapshot = useMemo(
		() => ({ profileId, spaceId, items }),
		[profileId, spaceId, items]
	);
	return (
		<PublishVisibleWakeProgressContext.Provider value={publisher}>
			<VisibleWakeProgressSnapshotContext.Provider value={snapshot}>
				{input.children}
			</VisibleWakeProgressSnapshotContext.Provider>
		</PublishVisibleWakeProgressContext.Provider>
	);
}

export function usePublishSpaceWakeProgressVisibleProjection(
	items: readonly WakeProgressItem[],
	scope: ConversationScope
): void {
	const publisher = useContext(PublishVisibleWakeProgressContext);
	const publish =
		publisher && sameScope(publisher, scope) ? publisher.publish : null;
	useLayoutEffect(() => {
		if (publish) {
			recordReactUpdate("space_wake_visible_publish");
		}
		return publish?.(items);
	}, [items, publish]);
}

export function useSpaceWakeProgressVisibleProjection(
	scope: ConversationScope
): VisibleWakeProgressSnapshot {
	const snapshot = useContext(VisibleWakeProgressSnapshotContext);
	return snapshot && sameScope(snapshot, scope) ? snapshot.items : null;
}
