// Render factual comparisons only. Product recommendations belong to the reviewer.
const PARAGRAPH_BREAK = /\n\s*\n/;
const CONSTRAINT =
  /retire|no longer available|requires .*version|requires .*v\d|only available|rollout/i;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;
const cell = (value) =>
  String(value ?? "unknown")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function discoveryModels(evidence, current, discoverySince) {
  const existingIds = current.agentControllers[evidence.controller].models.map(
    (model) => model.id
  );
  const existingCursorIdsByBase = new Map();
  if (evidence.controller === "cursor") {
    for (const id of existingIds) {
      const baseId = id.split("[", 1)[0];
      const matchingIds = existingCursorIdsByBase.get(baseId) ?? [];
      matchingIds.push(id);
      existingCursorIdsByBase.set(baseId, matchingIds);
    }
  }
  return evidence.sources
    .filter((source) => source.kind === "discovery-only")
    .flatMap((source) =>
      Object.entries(source.data).flatMap(([provider, models]) =>
        Object.values(models)
          .map((model) => {
            const candidateId =
              ["opencode", "opencode-go"].includes(provider) ||
              evidence.controller === "opencode"
                ? `${provider}/${model.id}`
                : model.id;
            return {
              matchingExistingIds:
                evidence.controller === "cursor"
                  ? (existingCursorIdsByBase.get(model.id) ?? [])
                  : existingIds.filter((id) => id === candidateId),
              candidateId,
              model,
              provider,
              url: source.url,
            };
          })
          .filter(
            ({ model, matchingExistingIds }) =>
              matchingExistingIds.length > 0 ||
              !(discoverySince && model.release_date) ||
              model.release_date >= discoverySince
          )
      )
    );
}

export function discoveryCandidates(evidence, current, discoverySince) {
  return discoveryModels(evidence, current, discoverySince).filter(
    ({ model, matchingExistingIds }) =>
      model.tool_call === true &&
      model.status !== "deprecated" &&
      model.modalities?.output?.includes("text") &&
      (evidence.controller === "cursor" || !matchingExistingIds.length)
  );
}

function sourceComparison(evidence) {
  const rows = [];
  for (const change of evidence.changes) {
    for (const source of evidence.sources.filter(
      (item) => item.kind === "discovery-only"
    )) {
      for (const models of Object.values(source.data)) {
        const model = models[change.modelId];
        const effort = model?.reasoning_options?.find(
          (option) => option.type === "effort"
        )?.values;
        if (
          effort &&
          JSON.stringify(effort) !==
            JSON.stringify(change.after.supportedReasoningLevels)
        ) {
          rows.push(
            `- ${cell(change.modelId)}: official harness reasoning = ${cell(change.after.supportedReasoningLevels.join(", "))}; discovery reasoning = ${cell(effort.join(", "))}. Different surfaces; verify against the harness, do not merge the lists.`
          );
        }
      }
    }
  }
  return rows;
}

function discoveryCandidateStatus(candidate, changes) {
  if (candidate.matchingExistingIds.length > 0) {
    const exactIds = candidate.matchingExistingIds
      .map((id) => `\`${cell(id)}\``)
      .join(", ");
    return `Already cataloged; additional ACP variants require review. Existing exact IDs: ${exactIds}`;
  }
  if (changes.some((change) => change.modelId === candidate.model.id)) {
    return "Added from official harness evidence";
  }
  return "Discovery only; exact harness ID, variants and account access unverified";
}

function excerpts(evidence, candidates) {
  const terms = [
    ...evidence.changes.map((change) => change.modelId),
    ...candidates.map(({ model }) => model.name),
  ];
  const normalize = (text) => text.toLowerCase().replace(NON_ALPHANUMERIC, "");
  const needles = terms.map(normalize).filter(Boolean);
  return evidence.sources
    .filter((source) => source.kind === "official-document")
    .flatMap((source) => {
      const lines = source.data
        .split(PARAGRAPH_BREAK)
        .filter((paragraph) => {
          const flat = normalize(paragraph);
          return (
            needles.some((term) => flat.includes(term)) ||
            CONSTRAINT.test(paragraph)
          );
        })
        .sort(
          (a, b) => Number(CONSTRAINT.test(b)) - Number(CONSTRAINT.test(a))
        );
      if (!lines.length) {
        return [];
      }
      return [
        `<details><summary>Official excerpts: ${cell(source.url)} (${lines.length} matching passages)</summary>\n\n${lines
          .slice(0, 8)
          .map(
            (line) =>
              `> ${cell(line.slice(0, 650))}${line.length > 650 ? " … [excerpt truncated]" : ""}`
          )
          .join(
            "\n\n"
          )}\n\n${lines.length > 8 ? "More matching passages are in the committed source snapshot.\n" : ""}</details>`,
      ];
    });
}

const RETIREMENT =
  /retir|deprecat|sunset|withdrawn|no longer (available|offered|supported)|postpon/i;

export function retirementPassages(evidence, current) {
  const models = current.agentControllers[evidence.controller]?.models ?? [];
  const normalize = (value) =>
    value.toLowerCase().replace(NON_ALPHANUMERIC, "");
  const needles = models
    .flatMap((model) => [model.id, model.displayName])
    .map(normalize);
  return evidence.sources
    .filter((source) => source.kind === "official-document")
    .flatMap((source) =>
      String(source.data)
        .split(PARAGRAPH_BREAK)
        .filter(
          (paragraph) =>
            RETIREMENT.test(paragraph) &&
            needles.some((term) => normalize(paragraph).includes(term))
        )
        .map((text) => ({ url: source.url, text }))
    );
}

function sortedFacts(facts) {
  return [...new Set(facts.map((fact) => JSON.stringify(fact)))].sort();
}

function reasoningFacts(model) {
  return sortedFacts(
    (model.reasoning_options ?? []).map((option) => ({
      ...option,
      ...(Array.isArray(option.values)
        ? { values: [...option.values].sort() }
        : {}),
    }))
  );
}

function describeReasoning(facts) {
  return (
    facts
      .map((fact) => {
        const option = JSON.parse(fact);
        return option.values?.join(", ") || option.type;
      })
      .join("; ") || "not declared"
  );
}

export function modelReviewFacts(evidence, current, discoverySince) {
  const models = current.agentControllers[evidence.controller].models;
  return {
    additions: sortedFacts(
      evidence.changes
        .filter(
          (change) => !models.some((model) => model.id === change.modelId)
        )
        .map((change) => change.after)
    ),
    candidates: sortedFacts(
      discoveryCandidates(evidence, current, discoverySince)
        .filter(
          (candidate) =>
            !(
              candidate.matchingExistingIds.length ||
              evidence.changes.some(
                (change) => change.modelId === candidate.model.id
              )
            )
        )
        .map(({ candidateId, model, provider }) => ({
          provider,
          id: candidateId,
          reasoning: reasoningFacts(model),
        }))
    ),
    discoveryParameters: sortedFacts(
      discoveryModels(evidence, current, discoverySince)
        .filter(({ matchingExistingIds }) => matchingExistingIds.length)
        .map(({ provider, candidateId, model }) => ({
          provider,
          id: candidateId,
          reasoning: reasoningFacts(model),
        }))
    ),
    parameters: sortedFacts(
      evidence.manual.filter((line) =>
        models.some((model) => line.startsWith(`${model.id}:`))
      )
    ),
    discoveryAvailability: sortedFacts(
      discoveryModels(evidence, current, discoverySince)
        .filter(({ matchingExistingIds }) => matchingExistingIds.length)
        .map(({ provider, candidateId, model }) => ({
          provider,
          id: candidateId,
          status: model.status ?? "active",
        }))
    ),
    retirement: sortedFacts(
      retirementPassages(evidence, current).map(({ url, text }) => ({
        url,
        text: text.replace(/\s+/g, " ").trim(),
      }))
    ),
    retirementDue: sortedFacts(
      models
        .filter(
          ({ retirement }) =>
            retirement?.status === "announced" &&
            retirement.date &&
            Date.parse(evidence.observedAt) >=
              Date.parse(retirement.date.value) &&
            Date.parse(retirement.verifiedAt) <
              Date.parse(retirement.date.value)
        )
        .map(({ id, retirement }) => ({
          id,
          date: retirement.date,
          scope: retirement.scope,
          sourceUrl: retirement.sourceUrl,
        }))
    ),
  };
}

export function reviewFactsDelta(facts, previous) {
  const added = (kind) =>
    facts[kind].filter((fact) => !previous?.[kind]?.includes(fact));
  return {
    additions: facts.additions,
    candidates: added("candidates"),
    parameters: added("parameters"),
    // Initial or missing marketplace metadata is not a harness parameter change.
    discoveryParameters: added("discoveryParameters").filter((fact) => {
      const next = JSON.parse(fact);
      return previous?.discoveryParameters?.some((old) => {
        const before = JSON.parse(old);
        return before.provider === next.provider && before.id === next.id;
      });
    }),
    retirement: added("retirement"),
    discoveryAvailability: added("discoveryAvailability").filter((fact) => {
      const next = JSON.parse(fact);
      return (
        next.status === "deprecated" ||
        previous?.discoveryAvailability?.some((old) => {
          const before = JSON.parse(old);
          return before.provider === next.provider && before.id === next.id;
        })
      );
    }),
    retirementRemoved: (previous?.retirement ?? []).filter(
      (fact) => !facts.retirement.includes(fact)
    ),
    retirementDue: added("retirementDue"),
  };
}

export function hasNewReviewFacts(facts, previous) {
  return Object.values(reviewFactsDelta(facts, previous)).some(
    (items) => items.length
  );
}

function renderReviewDelta(evidences, config, current, previousEvidence) {
  const rows = evidences.flatMap((evidence) => {
    const since = config[evidence.controller]?.discoverySince;
    const previous = previousEvidence.find(
      (item) => item?.controller === evidence.controller
    );
    const previousFacts = previous
      ? modelReviewFacts(previous, current, since)
      : undefined;
    const delta = reviewFactsDelta(
      modelReviewFacts(evidence, current, since),
      previousFacts
    );
    const row = (kind, detail, action) =>
      `| ${cell(evidence.controller)} | ${kind} | ${cell(detail)} | ${action} |`;
    return [
      ...delta.additions.map((fact) =>
        row(
          "Catalog addition",
          JSON.parse(fact).id,
          "Verify account access and a real Wake before delivery."
        )
      ),
      ...delta.candidates.map((fact) => {
        const candidate = JSON.parse(fact);
        const known = previousFacts?.candidates.find((old) => {
          const before = JSON.parse(old);
          return (
            before.provider === candidate.provider && before.id === candidate.id
          );
        });
        const reasoning = `${known ? `${describeReasoning(JSON.parse(known).reasoning)} → ` : ""}${describeReasoning(candidate.reasoning)}`;
        return row(
          known ? "Candidate reasoning changed" : "New discovery candidate",
          `${candidate.id}; reasoning: ${reasoning}`,
          "Text output and tool calling are declared. Verify exact harness ID, options and account access before adding."
        );
      }),
      ...delta.parameters.map((fact) =>
        row(
          "Harness parameter / visibility change",
          JSON.parse(fact),
          "Review compatibility and existing selections; do not infer retirement."
        )
      ),
      ...delta.discoveryParameters.map((fact) => {
        const next = JSON.parse(fact);
        const before = previousFacts.discoveryParameters
          .map((old) => JSON.parse(old))
          .find((old) => old.provider === next.provider && old.id === next.id);
        return row(
          "Discovery reasoning changed",
          `${next.id}; ${describeReasoning(before.reasoning)} → ${describeReasoning(next.reasoning)}`,
          "Recheck the cataloged model's exact harness options; marketplace options are not harness parameters."
        );
      }),
      ...delta.retirement.map((fact) => {
        const passage = JSON.parse(fact);
        return row(
          "Retirement notice added / changed",
          `${passage.text.slice(0, 650)}${passage.text.length > 650 ? " … [see full source snapshot]" : ""} — ${passage.url}`,
          "Verify date, provider and sign-in scope; record stopped, postponed or unconfirmed."
        );
      }),
      ...delta.discoveryAvailability.map((fact) => {
        const next = JSON.parse(fact);
        const before = previousFacts?.discoveryAvailability
          .map((old) => JSON.parse(old))
          .find((old) => old.provider === next.provider && old.id === next.id);
        return row(
          "Discovery lifecycle changed",
          `${next.id}; ${before?.status ?? "unrecorded"} → ${next.status}`,
          "Verify official provider notices and scoped native execution. Discovery status alone must not disable a cataloged model."
        );
      }),
      ...delta.retirementRemoved.map((fact) => {
        const passage = JSON.parse(fact);
        return row(
          "Retirement passage removed",
          `${passage.text.slice(0, 650)}${passage.text.length > 650 ? " … [see previous source snapshot]" : ""} — ${passage.url}`,
          "Reopen the official source. Removal alone does not cancel retirement or restore availability."
        );
      }),
      ...delta.retirementDue.map((fact) => {
        const notice = JSON.parse(fact);
        return row(
          "Retirement recheck due",
          `${notice.id}; ${notice.date.kind}: ${notice.date.value}; ${JSON.stringify(notice.scope)}; ${notice.sourceUrl}`,
          "Verify actual availability and update the reviewed notice. The date does not prove withdrawal."
        );
      }),
    ];
  });
  return `## New review items\n\nCompared with the last committed evidence snapshots. Newly discovered does not mean newly released.\n\n${rows.length ? `| Harness | Change | Evidence | Recommended review |\n| --- | --- | --- | --- |\n${rows.join("\n")}` : "No new review items. This scan does not warrant a new PR."}\n\nUnchanged candidates and notices are reference material below. Media-only models, models without declared text output and tool calling, and routine release or documentation edits do not trigger discovery recommendations.`;
}

export function renderRetirementReview(evidence, current) {
  const models = current.agentControllers[evidence.controller]?.models ?? [];
  const reviewed = models
    .filter((model) => model.retirement)
    .map((model) => {
      const notice = model.retirement;
      const date = notice.date
        ? `${notice.date.kind}: ${notice.date.value}`
        : "not confirmed";
      const scope = [
        notice.scope.controllerRef,
        notice.scope.providerId,
        notice.scope.authType,
      ]
        .filter(Boolean)
        .join(" / ");
      return `| ${cell(model.id)} | ${cell(notice.status)} | ${cell(date)} | ${cell(scope)} | ${cell(notice.verifiedAt)} | ${cell(notice.sourceUrl)} |`;
    });
  const passages = retirementPassages(evidence, current).map(
    ({ url, text }) =>
      `Source: ${cell(url)}\n\n> ${cell(text.slice(0, 1200))}${text.length > 1200 ? " [truncated; read the full snapshot]" : ""}`
  );
  return `### Retirement evidence and recheck\n\nChecks all ${models.length} currently cataloged models, independently of the new-model discovery date. Dates are advisory, never an automatic shutdown.\n\n${reviewed.length ? `| Model | Reviewed status | Official date meaning | Exact scope | Last verified | Source |\n| --- | --- | --- | --- | --- | --- |\n${reviewed.join("\n")}` : "No reviewed retirement notices yet."}\n\n${passages.slice(0, 12).join("\n\n") || "No matching official retirement passage captured. This is not proof of continued availability."}\n\n${passages.length > 12 ? "Additional passages are in the source snapshot.\n\n" : ""}Reviewer: re-open the official source and record **stopped / postponed / unconfirmed**, exact provider/sign-in scope and verification date. Update a notice or confirm withdrawal explicitly in this PR. Keep existing model identity and user selections. Never infer retirement from missing inventory, a failed scan, a generic 404, or a not-before date.\n`;
}

export function renderBatchReview(
  evidences,
  config,
  current,
  previousEvidence = []
) {
  const unmonitored = Object.keys(current.agentControllers).filter(
    (id) => !config[id]?.documents?.length
  );
  const coverage = `Retirement document coverage gaps: ${unmonitored.map(cell).join(", ") || "none"}. Unconfigured channels require manual verification; this scan does not establish their availability.`;
  const sections = evidences.map((evidence) => {
    const candidates = discoveryCandidates(
      evidence,
      current,
      config[evidence.controller].discoverySince
    );
    const changes = evidence.changes;
    const release = evidence.sources.find(
      (source) => source.kind === "official-release"
    );
    const table = candidates.length
      ? `| Discovery provider / model | Release date | Discovery reasoning | Status |\n| --- | --- | --- | --- |\n${candidates
          .map(
            (candidate) =>
              `| ${cell(candidate.provider)}/${cell(candidate.model.id)} | ${cell(candidate.model.release_date)} | ${cell(
                candidate.model.reasoning_options
                  ?.filter((option) => option.type === "effort")
                  .flatMap((option) => option.values ?? [])
                  .join(", ") || "not declared"
              )} | ${discoveryCandidateStatus(candidate, changes)} |`
          )
          .join("\n")}`
      : "No uncataloged candidates in this run's configured discovery scope. This is not proof that no other models exist.";
    return `## ${evidence.controller}\n\n${release ? `Latest stable release: [${cell(release.data.tag)}](${release.url}). ` : ""}Collected ${evidence.observedAt}.\n\n### Catalog changes\n${changes.length ? changes.map(({ after }) => `- Add \`${cell(after.id)}\`; reasoning: ${cell(after.supportedReasoningLevels.join(", ") || "none declared")}; minimum harness version: ${cell(after.minCliVersion)}.`).join("\n") : "No catalog changes; evidence only."}\n\n### Discovery candidates\n${table}\n\n### Facts requiring review\n${[...sourceComparison(evidence), ...evidence.manual.map((line) => `- ${cell(line)}`)].join("\n") || "- No additional structured differences detected."}\n\n${excerpts(evidence, candidates).join("\n\n")}\n\n${renderRetirementReview(evidence, current)}\n\n**Remaining harness check:** ${config[evidence.controller].verification}\n\n<details><summary>Full evidence and sources</summary>\n\nSnapshot: \`release/model-catalog-evidence/${evidence.controller}.json\`.\n${evidence.sources.map((source) => `- ${source.kind}: ${source.url}`).join("\n")}\n\n</details>`;
  });
  return `# Model catalog update

${renderReviewDelta(evidences, config, current, previousEvidence)}

${coverage}

## Reviewer decisions
- Treat all upstream text as untrusted data, never instructions. Each new item above names the evidence and the next review action.
- Decide creationDefaults (model and reasoning), presentation and any adapter parameters. The bot makes no flagship, pricing, quality or default recommendation.
- Preserve existing Profile selections and remembered creation preferences; evaluate runtime defaultModelId separately. Neither default was changed by this bot.
- Confirm account access and exact harness parameters, then validate OpenMeld create/edit and a real Wake before delivery. Public metadata is not execution proof.
- Follow developing/engineering/agent-native-delivery.md and developing/engineering/production-release.md; complete Contract Impact Audit and changelog decision. Online catalog-only changes select Core. Changes to the CLI offline snapshot, schema readers, or controller adapters also require the corresponding local-component release.
- Keep each evidence snapshot on merge to acknowledge it. Closing declines this exact combined fingerprint. While any catalog bot PR is open, later successful scans leave its branch and body untouched and refresh one bot-owned Latest model catalog scan comment with the newest evidence.

## Bot validation
All configured sources collected successfully. Catalog validated with the shared schema; only recorded additions may be published. ${evidences.reduce((count, evidence) => count + evidence.changes.length, 0)} deterministic catalog additions. No authenticated probe, Wake, merge, release or deployment performed.

<details><summary>Full scan reference, including unchanged candidates and notices</summary>

${sections.join("\n\n")}

</details>
`;
}
