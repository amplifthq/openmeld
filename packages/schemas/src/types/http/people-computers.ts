import type { z } from "zod/v4";

export type PeopleComputerFileAccessReadRpcInput = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerFileAccessReadRpcInputSchema
>;
export type PeopleComputerFileAccessUpdateRpcInput = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerFileAccessUpdateRpcInputSchema
>;
export type PeopleComputerFileAccessUpdateBody = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerFileAccessUpdateBodySchema
>;

export type PeopleComputerTarget = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerTargetSchema
>;
export type PeopleComputer = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerSchema
>;
export type PeopleComputerConnection = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputerConnectionSchema
>;
export type PeopleComputersResponse = z.infer<
  typeof import("../../schemas/http/people-computers").peopleComputersResponseSchema
>;
