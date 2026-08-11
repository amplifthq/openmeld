import type { z } from "zod/v4";

type OpenDirectMessageSpaceBodySchema =
  typeof import("../../schemas/http/space-direct-message")["openDirectMessageSpaceBodySchema"];
type OpenDirectMessageSpaceResponseSchema =
  typeof import("../../schemas/http/space-direct-message")["openDirectMessageSpaceResponseSchema"];
type ConvertDirectMessageToSpaceBodySchema =
  typeof import("../../schemas/http/space-direct-message")["convertDirectMessageToSpaceBodySchema"];
type ConvertDirectMessageToSpaceResponseSchema =
  typeof import("../../schemas/http/space-direct-message")["convertDirectMessageToSpaceResponseSchema"];

export type OpenDirectMessageSpaceBody =
  z.infer<OpenDirectMessageSpaceBodySchema>;
export type OpenDirectMessageSpaceResponse =
  z.infer<OpenDirectMessageSpaceResponseSchema>;
export type ConvertDirectMessageToSpaceBody =
  z.infer<ConvertDirectMessageToSpaceBodySchema>;
export type ConvertDirectMessageToSpaceResponse =
  z.infer<ConvertDirectMessageToSpaceResponseSchema>;
