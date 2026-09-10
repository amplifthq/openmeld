import * as z from "zod/v4";

export const spaceOwnerDepartureInputSchema = z.strictObject({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});
export const spaceOwnerDepartureResultSchema = z.strictObject({
  spaces: z.array(
    z.strictObject({ spaceId: z.string().min(1), name: z.string() })
  ),
});
export type SpaceOwnerDepartureInput = z.infer<
  typeof spaceOwnerDepartureInputSchema
>;
export const spaceOwnerDepartureSpaceInputSchema =
  spaceOwnerDepartureInputSchema.extend({ spaceId: z.string().min(1) });
export type SpaceOwnerDepartureSpaceInput = z.infer<
  typeof spaceOwnerDepartureSpaceInputSchema
>;
export type SpaceOwnerDepartureResult = z.infer<
  typeof spaceOwnerDepartureResultSchema
>;
export type SpaceOwnerDepartureWorker = {
  checkSpaceOwnerDeparture(
    input: SpaceOwnerDepartureInput
  ): Promise<SpaceOwnerDepartureResult>;
};
