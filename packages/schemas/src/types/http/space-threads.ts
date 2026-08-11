import type { z } from "zod/v4";

type CreateSpaceThreadBodySchema =
  typeof import("../../schemas/http/space-threads")["createSpaceThreadBodySchema"];
type CreateSpaceThreadResponseSchema =
  typeof import("../../schemas/http/space-threads")["createSpaceThreadResponseSchema"];
type GetSpaceThreadResponseSchema =
  typeof import("../../schemas/http/space-threads")["getSpaceThreadResponseSchema"];
type ListSpaceThreadEventsResponseSchema =
  typeof import("../../schemas/http/space-threads")["listSpaceThreadEventsResponseSchema"];
type ListSpaceThreadsResponseSchema =
  typeof import("../../schemas/http/space-threads")["listSpaceThreadsResponseSchema"];
type ListSpaceThreadSignalsResponseSchema =
  typeof import("../../schemas/http/space-threads")["listSpaceThreadSignalsResponseSchema"];
type ListSpaceThreadSignalsQuerySchema =
  typeof import("../../schemas/http/space-threads")["listSpaceThreadSignalsQuerySchema"];
type PostSpaceThreadSignalBodySchema =
  typeof import("../../schemas/http/space-threads")["postSpaceThreadSignalBodySchema"];
type PostSpaceThreadSignalResponseSchema =
  typeof import("../../schemas/http/space-threads")["postSpaceThreadSignalResponseSchema"];
type SpaceThreadPreviewSchema =
  typeof import("../../schemas/http/space-threads")["spaceThreadPreviewSchema"];

export type CreateSpaceThreadBody = z.infer<CreateSpaceThreadBodySchema>;
export type CreateSpaceThreadResponse =
  z.infer<CreateSpaceThreadResponseSchema>;
export type GetSpaceThreadResponse = z.infer<GetSpaceThreadResponseSchema>;
export type ListSpaceThreadEventsResponse =
  z.infer<ListSpaceThreadEventsResponseSchema>;
export type ListSpaceThreadsResponse = z.infer<ListSpaceThreadsResponseSchema>;
export type ListSpaceThreadSignalsResponse =
  z.infer<ListSpaceThreadSignalsResponseSchema>;
export type ListSpaceThreadSignalsQuery =
  z.infer<ListSpaceThreadSignalsQuerySchema>;
export type PostSpaceThreadSignalBody =
  z.infer<PostSpaceThreadSignalBodySchema>;
export type PostSpaceThreadSignalResponse =
  z.infer<PostSpaceThreadSignalResponseSchema>;
export type SpaceThreadPreview = z.infer<SpaceThreadPreviewSchema>;
