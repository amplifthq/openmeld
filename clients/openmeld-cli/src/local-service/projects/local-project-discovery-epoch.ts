import { createHash, randomUUID } from "node:crypto";
import type { LocalProjectControlProjectDiscovery } from "@openmeld/schemas";

type DiscoveryEpochToken = {
  epochId: string;
  organizationId: string;
  sequence: number;
};

type CurrentDiscoveryEpoch = DiscoveryEpochToken & {
  discoveryCandidateIdsByToken: Map<string, string>;
};

export class LocalProjectDiscoveryEpochs {
  private readonly currentByOrganization = new Map<
    string,
    CurrentDiscoveryEpoch
  >();
  private nextSequence = 1;
  private readonly createEpochId: () => string;

  constructor(createEpochId: () => string = randomUUID) {
    this.createEpochId = createEpochId;
  }

  begin(input: { organizationId: string }): DiscoveryEpochToken {
    const token = {
      epochId: this.createEpochId(),
      ...input,
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.currentByOrganization.set(input.organizationId, {
      ...token,
      discoveryCandidateIdsByToken: new Map(),
    });
    return token;
  }

  complete(
    token: DiscoveryEpochToken,
    projects: readonly LocalProjectControlProjectDiscovery[]
  ): LocalProjectControlProjectDiscovery[] {
    const scopedProjects = projects.map((project) => ({
      ...project,
      candidates: project.candidates.map((candidate) => ({
        ...candidate,
        candidateId: buildEpochCandidateId({
          candidateId: candidate.candidateId,
          epochId: token.epochId,
        }),
      })),
    }));
    const current = this.currentByOrganization.get(token.organizationId);
    if (!current || current.sequence !== token.sequence) {
      return scopedProjects;
    }
    const discoveryCandidateIdsByToken = new Map<string, string>();
    for (const [projectIndex, project] of scopedProjects.entries()) {
      for (const [candidateIndex, candidate] of project.candidates.entries()) {
        const discoveryCandidateId =
          projects[projectIndex]?.candidates[candidateIndex]?.candidateId;
        if (!discoveryCandidateId) {
          throw new Error(
            "The scoped Project candidate is missing its identity."
          );
        }
        discoveryCandidateIdsByToken.set(
          buildCandidateToken({
            candidateId: candidate.candidateId,
            candidatePath: candidate.canonicalPath,
            projectId: project.projectId,
          }),
          discoveryCandidateId
        );
      }
    }
    this.currentByOrganization.set(token.organizationId, {
      ...token,
      discoveryCandidateIdsByToken,
    });
    return scopedProjects;
  }

  resolveDiscoveryCandidateId(input: {
    candidateId: string;
    candidatePath: string;
    organizationId: string;
    projectId: string;
  }): string | null {
    const current = this.currentByOrganization.get(input.organizationId);
    return (
      current?.discoveryCandidateIdsByToken.get(buildCandidateToken(input)) ??
      null
    );
  }
}

function buildEpochCandidateId(input: {
  candidateId: string;
  epochId: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function buildCandidateToken(input: {
  candidateId: string;
  candidatePath: string;
  projectId: string;
}): string {
  const identity = {
    candidateId: input.candidateId,
    candidatePath: input.candidatePath,
    projectId: input.projectId,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
