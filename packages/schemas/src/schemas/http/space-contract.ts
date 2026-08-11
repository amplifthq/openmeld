import {
  spaceContractFieldsSchema,
  spaceContractSchema,
} from "../space-mesh/space-contract";

export const putSpaceContractBodySchema = spaceContractFieldsSchema;
export const patchSpaceContractBodySchema = spaceContractFieldsSchema
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
