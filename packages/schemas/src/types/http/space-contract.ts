import type { z } from "zod/v4";

type GetSpaceContractResponseSchema =
  typeof import("../../schemas/http/space-contract")["getSpaceContractResponseSchema"];
type PutSpaceContractBodySchema =
  typeof import("../../schemas/http/space-contract")["putSpaceContractBodySchema"];
type PatchSpaceContractBodySchema =
  typeof import("../../schemas/http/space-contract")["patchSpaceContractBodySchema"];
type PutSpaceContractResponseSchema =
  typeof import("../../schemas/http/space-contract")["putSpaceContractResponseSchema"];
type PatchSpaceContractResponseSchema =
  typeof import("../../schemas/http/space-contract")["patchSpaceContractResponseSchema"];

export type GetSpaceContractResponse = z.infer<GetSpaceContractResponseSchema>;
export type PutSpaceContractBody = z.infer<PutSpaceContractBodySchema>;
export type PatchSpaceContractBody = z.infer<PatchSpaceContractBodySchema>;
export type PutSpaceContractResponse = z.infer<PutSpaceContractResponseSchema>;
export type PatchSpaceContractResponse =
  z.infer<PatchSpaceContractResponseSchema>;
