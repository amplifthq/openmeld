"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import type { InboxVisibleConversation } from "#/lib/inbox/source-target";

export type { InboxVisibleConversation } from "#/lib/inbox/source-target";

type PublishedConversation = {
	conversation: InboxVisibleConversation;
	owner: symbol;
};

type InboxVisibleConversationContextValue = {
	conversation: InboxVisibleConversation | null;
	publish: (
		owner: symbol,
		conversation: InboxVisibleConversation | null
	) => void;
};

const InboxVisibleConversationContext =
	createContext<InboxVisibleConversationContextValue>({
		conversation: null,
		publish: () => undefined,
	});

export function InboxVisibleConversationProvider(input: {
	children: ReactNode;
}) {
	const [published, setPublished] = useState<PublishedConversation | null>(
		null
	);
	const publish = useCallback(
		(owner: symbol, conversation: InboxVisibleConversation | null) => {
			setPublished((current) => {
				if (conversation) {
					return { conversation, owner };
				}
				return current?.owner === owner ? null : current;
			});
		},
		[]
	);
	const value = useMemo<InboxVisibleConversationContextValue>(
		() => ({
			conversation: published?.conversation ?? null,
			publish,
		}),
		[publish, published?.conversation]
	);

	return (
		<InboxVisibleConversationContext.Provider value={value}>
			{input.children}
		</InboxVisibleConversationContext.Provider>
	);
}

export function useInboxVisibleConversation(): InboxVisibleConversation | null {
	return useContext(InboxVisibleConversationContext).conversation;
}

export function usePublishInboxVisibleConversation(
	conversation: InboxVisibleConversation | null
): void {
	const { publish } = useContext(InboxVisibleConversationContext);
	const [owner] = useState(() => Symbol("inbox-visible-conversation"));
	const kind = conversation?.kind;
	const spaceId = conversation?.spaceId;
	const threadRootSignalId = conversation?.threadRootSignalId;

	useLayoutEffect(() => {
		const currentConversation =
			kind === "space" && spaceId
				? {
						kind,
						spaceId,
						threadRootSignalId: threadRootSignalId ?? null,
					}
				: null;
		publish(owner, currentConversation);
		return () => publish(owner, null);
	}, [kind, owner, publish, spaceId, threadRootSignalId]);
}
