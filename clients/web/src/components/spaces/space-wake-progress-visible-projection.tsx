"use client";

import type { WakeProgressItem } from "@openmeld/schemas/types";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useState,
} from "react";

type VisibleWakeProgressSnapshot = readonly WakeProgressItem[] | null;

type PublishVisibleWakeProgress = (items: readonly WakeProgressItem[]) => void;

const VisibleWakeProgressSnapshotContext =
	createContext<VisibleWakeProgressSnapshot>(null);
const PublishVisibleWakeProgressContext =
	createContext<PublishVisibleWakeProgress | null>(null);

export function SpaceWakeProgressVisibleProjectionProvider(input: {
	children: ReactNode;
}) {
	const [snapshot, setSnapshot] = useState<VisibleWakeProgressSnapshot>(null);
	const publish = useCallback<PublishVisibleWakeProgress>((items) => {
		setSnapshot((current) => (current === items ? current : items));
	}, []);
	return (
		<PublishVisibleWakeProgressContext.Provider value={publish}>
			<VisibleWakeProgressSnapshotContext.Provider value={snapshot}>
				{input.children}
			</VisibleWakeProgressSnapshotContext.Provider>
		</PublishVisibleWakeProgressContext.Provider>
	);
}

export function usePublishSpaceWakeProgressVisibleProjection(
	items: readonly WakeProgressItem[]
): void {
	const publish = useContext(PublishVisibleWakeProgressContext);
	useLayoutEffect(() => {
		publish?.(items);
	}, [items, publish]);
}

export function useSpaceWakeProgressVisibleProjection(): VisibleWakeProgressSnapshot {
	return useContext(VisibleWakeProgressSnapshotContext);
}
