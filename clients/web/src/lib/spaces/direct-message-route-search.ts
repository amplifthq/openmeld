import { z } from "zod/v4";

const directMessageRouteSearchSchema = z.object({
	focusInteractionId: z.string().trim().min(1).optional(),
	focusSignalId: z.string().trim().min(1).optional(),
	focusThreadRootSignalId: z.string().trim().min(1).optional(),
	profileId: z.string().trim().min(1).optional(),
});

export function parseDirectMessageRouteSearch(search: unknown) {
	const parsed = directMessageRouteSearchSchema.safeParse(search);
	return parsed.success ? parsed.data : {};
}
