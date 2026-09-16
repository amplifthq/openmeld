import {
  type SpaceOwnerDepartureWorker,
  spaceOwnerDepartureResultSchema,
} from "@openmeld/schemas";
import { APIError } from "better-auth";

export async function requireSpaceOwnershipHandoff(input: {
  coreWorker?: SpaceOwnerDepartureWorker;
  organizationId: string;
  userId: string;
}): Promise<void> {
  if (!input.coreWorker) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "space.ownership_unavailable",
      message: "Couldn't check Space ownership. Try again.",
    });
  }
  const result = spaceOwnerDepartureResultSchema.parse(
    await input.coreWorker.checkSpaceOwnerDeparture({
      organizationId: input.organizationId,
      userId: input.userId,
    })
  );
  if (result.spaces.length === 0) {
    return;
  }
  const names = result.spaces
    .slice(0, 5)
    .map((space) => space.name)
    .join(", ");
  throw new APIError("CONFLICT", {
    code: "space.ownership_handoff_required",
    message: `Hand over Space ownership before leaving or removing this member: ${names}${result.spaces.length > 5 ? ` and ${result.spaces.length - 5} more` : ""}. Add another owner, then change the departing person's role to Member.`,
  });
}
