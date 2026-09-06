import type { z } from "zod/v4";

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
