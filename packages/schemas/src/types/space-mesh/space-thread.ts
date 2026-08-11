import type { z } from "zod/v4";

type SpaceThreadSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadSchema"];
type SpaceThreadActionRefSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadActionRefSchema"];
type SpaceThreadContextSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadContextSchema"];
type SpaceThreadEventSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadEventSchema"];
type SpaceThreadEventTypeSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadEventTypeSchema"];
type SpaceThreadSignalPlacementSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadSignalPlacementSchema"];
type SpaceThreadSignalPlacementKindSchema =
  typeof import("../../schemas/space-mesh/space-thread")["spaceThreadSignalPlacementKindSchema"];

export type SpaceThread = z.infer<SpaceThreadSchema>;
export type SpaceThreadActionRef = z.infer<SpaceThreadActionRefSchema>;
export type SpaceThreadContext = z.infer<SpaceThreadContextSchema>;
export type SpaceThreadEvent = z.infer<SpaceThreadEventSchema>;
export type SpaceThreadEventType = z.infer<SpaceThreadEventTypeSchema>;
export type SpaceThreadSignalPlacement =
  z.infer<SpaceThreadSignalPlacementSchema>;
export type SpaceThreadSignalPlacementKind =
  z.infer<SpaceThreadSignalPlacementKindSchema>;
