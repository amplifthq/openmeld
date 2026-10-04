const CONVERSATION_SCROLL_OWNER_PATH =
	/^\/(?:spaces\/[^/]+|o\/[^/]+\/(?:(?:spaces|chats|direct-messages)\/[^/]+|desk))\/?$/;

export function getAppScrollRestorationKey(location: {
	pathname: string;
}): string {
	return location.pathname;
}

export function shouldRestoreAppScroll(input: {
	location: { pathname: string };
}): boolean {
	// Conversation and Desk surfaces own their reading/canvas positions. Replaying
	// route coordinates after their layout effects would overwrite that position.
	// Keep this pathname-based so the server's inline restoration agrees too.
	return !CONVERSATION_SCROLL_OWNER_PATH.test(input.location.pathname);
}
