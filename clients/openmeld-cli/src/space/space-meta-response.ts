import type { SpaceMeta } from "@openmeld/protocol";
import { spaceMetaSchema } from "@openmeld/schemas";

type SpaceMetaParseOperation =
  | "createSpaceMeta"
  | "fetchSpaceMeta"
  | "updateSpaceMeta";

export function parseSpaceMetaPayload(input: {
  data: unknown;
  endpoint: string;
  operation: SpaceMetaParseOperation;
}): SpaceMeta {
  try {
    const validation = spaceMetaSchema.safeParse(input.data);
    if (!validation.success) {
      const reason =
        validation.error.issues[0]?.message ??
        "space meta payload does not match schema";
      throw new Error(reason);
    }
    return validation.data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${input.operation} received invalid response payload from ${input.endpoint}: ${reason}; raw=${JSON.stringify(input.data)}`
    );
  }
}

export function parseSpaceMetaResponse(input: {
  raw: string;
  endpoint: string;
  operation: Extract<
    SpaceMetaParseOperation,
    "fetchSpaceMeta" | "updateSpaceMeta"
  >;
}): SpaceMeta {
  try {
    return parseSpaceMetaPayload({
      data: JSON.parse(input.raw) as unknown,
      endpoint: input.endpoint,
      operation: input.operation,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${input.operation} received invalid response payload from ${input.endpoint}: ${reason}; raw=${input.raw}`
    );
  }
}
