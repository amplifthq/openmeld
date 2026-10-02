import {
  spaceContractFieldsSchema,
  spaceContractSchema,
} from "../space-mesh/space-contract";

// Old clients may echo the legacy mixed list. Narrow only: never convert
// status permission into reply permission. Stored/frozen contracts still use
// spaceContractSchema unchanged so historical proposals remain readable.
export const putSpaceContractBodySchema = spaceContractFieldsSchema.extend({
  allowedActions: spaceContractFieldsSchema.shape.allowedActions
    .transform((actions) =>
      actions.filter((action) => action !== "post_status")
    )
    .refine((actions) => actions.length > 0, {
      message:
        "The status tool is retired. Choose reply (post_message), stay_silent, or both; no replacement permission is granted automatically.",
    }),
});
export const patchSpaceContractBodySchema = putSpaceContractBodySchema
  .pick({
    dispatchPolicy: true,
    publicationMode: true,
    allowedActions: true,
    resultArchivePolicy: true,
    entryBrief: true,
    dispatchBrief: true,
  })
  .partial()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 0) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: "at least one contract patch field is required",
    });
  });
export const getSpaceContractResponseSchema = spaceContractSchema;
export const putSpaceContractResponseSchema = spaceContractSchema;
export const patchSpaceContractResponseSchema = spaceContractSchema;
