import { z } from "zod/v4";
import { spaceMembersFocusSearchShape } from "./space-members-focus";

const directMessageRouteSearchSchema = z.object({
	focusInteractionId: z.string().trim().min(1).optional(),
	focusSignalId: z.string().trim().min(1).optional(),
	focusThreadRootSignalId: z.string().trim().min(1).optional(),
	profileId: z.string().trim().min(1).optional(),
	...spaceMembersFocusSearchShape,
});

export function parseDirectMessageRouteSearch(search: unknown) {
	const parsed = directMessageRouteSearchSchema.safeParse(search);
	return parsed.success ? parsed.data : {};
}
