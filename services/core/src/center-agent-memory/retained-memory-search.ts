import type {
  CenterAgentMemoryDetailedReader,
  CenterAgentMemoryDetailedSearchItem,
  CenterAgentMemoryRead,
  CenterAgentMemoryReadRepository,
} from "./contract";
import { CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS } from "./contract";
import {
  combineMemoryReadStatus,
  interleaveMemoryScopes,
} from "./memory-selection";
import { withCenterAgentMemoryTimeout } from "./memory-service";

export type RetainedMemoryRead =
  CenterAgentMemoryRead<CenterAgentMemoryDetailedSearchItem>;

/** Existing retained subjects only; this path never invokes ensure/upsert/write. */
export async function searchRetainedCenterAgentMemory(input: {
  adapter: CenterAgentMemoryDetailedReader;
  repository: CenterAgentMemoryReadRepository;
  organizationId: string;
  speakerMember: { memberId: string; userId: string };
  query: string;
  limit: number;
  spaceId?: string;
}): Promise<RetainedMemoryRead> {
  try {
    const refs = await input.repository.readActiveSubjects(input);
    const results = await Promise.allSettled(
      refs.map((ref) =>
        withCenterAgentMemoryTimeout(
          input.adapter.searchDetailed({
            ref,
            query: input.query,
            limit: input.limit,
          }),
          CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS,
          "center_agent.memory_search_timeout"
        )
      )
    );
    // A provider read must not outlive deletion, policy opt-out, or a
    // replacement of the retained subject. Reuse the repository's authority.
    const currentRefs = await input.repository.readActiveSubjects(input);
    const reads = results.map((result, index) => {
      const ref = refs[index];
      const stillCurrent = currentRefs.some(
        (current) =>
          current.subjectId === ref?.subjectId &&
          current.updatedAtMs === ref.updatedAtMs
      );
      return result.status === "fulfilled" && stillCurrent
        ? result.value
        : { items: [], status: "unavailable" as const };
    });
    // Preserve provider rank within each scope without letting the first scope
    // consume the entire candidate window. This is not exhaustive history.
    const items = interleaveMemoryScopes(
      reads.map((result) => result.items.slice(0, input.limit))
    );
    return {
      items,
      status: combineMemoryReadStatus(reads.map((result) => result.status)),
    };
  } catch (error) {
    console.warn("[core.center_agent_memory.search_unavailable]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { items: [], status: "unavailable" };
  }
}
