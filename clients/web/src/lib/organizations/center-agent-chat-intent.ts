import { z } from "zod/v4";
import { createPendingCenterAgentMessage } from "./center-agent-pending-message";

const intentSchema = z.object({
	creationId: z.uuid(),
	message: z.object({
		clientMessageId: z.uuid(),
		createdAtMs: z.number(),
		text: z.string(),
	}),
});

/** Keep the creation identity through an uncertain response, navigation or reload. */
export function readOrCreateChatIntent(
	storage: Storage,
	key: string,
	text: string
) {
	const stored = storage.getItem(key);
	const previous = stored ? intentSchema.parse(JSON.parse(stored)) : null;
	const intent = previous ?? {
		creationId: crypto.randomUUID(),
		message: createPendingCenterAgentMessage(text),
	};
	if (intent.message.text !== text) {
		intent.message = createPendingCenterAgentMessage(text);
	}
	storage.setItem(key, JSON.stringify(intent));
	return intent;
}
