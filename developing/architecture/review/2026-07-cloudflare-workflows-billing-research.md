# Cloudflare Workflows Billing Research

## Agent Context

- Purpose: Record the official Cloudflare billing rules that matter when
  evaluating the cost risk of OpenMeld's Workflow-backed Routine Runs.
- Read this when: Reviewing Cloudflare Workflow step or storage costs,
  comparing the Workflow and Legacy Routine engines, or configuring billing
  monitoring and retention.
- Update this when: Cloudflare activates or changes Workflow step/storage
  billing, clarifies billable retry semantics, or OpenMeld changes its Routine
  execution engine or Workflow retention policy.
- Do not use this for: Proving OpenMeld's current production usage, estimating
  an OpenMeld invoice without account analytics, or treating Cloudflare's
  operational Workflow state as OpenMeld's Routine or Run source of truth.
- Source of truth: Cloudflare's linked pricing, changelog, API, limits, and
  billing documentation own the vendor facts. This file is a dated research
  snapshot, not a vendor contract.

Date: 2026-07-17

Status: RESEARCH SNAPSHOT. Re-check the official pricing and billing dashboard
on or immediately after 2026-08-10. Remove or distill this snapshot after the
billing start and OpenMeld's engine/retention decision have been verified.

## Bottom Line

Cloudflare has announced two additional paid dimensions for Workflows:
executed steps and persisted Workflow state. Cloudflare's pricing page says
billing starts on 2026-08-10, while its changelog uses the more cautious
"starting no earlier than" 2026-08-10. Requests and CPU time were already
billable and remain additive.

The expensive scenario is not long wall-clock waiting by itself:

- waiting on network I/O, `step.sleep`, or other idle time does not consume
  billable CPU time;
- the sleep or event-wait operation is nevertheless a billable step under the
  July 2026 definition; and
- the instance's persisted state remains billable while it is running,
  sleeping, errored, or retained after completion.

This means a large population of waiting instances with large persisted inputs
or step results can have low CPU cost but very high storage cost.

Cloudflare currently documents account-wide budget alerts, but they are
informational only and do not pause or cap usage. No official Workflows-specific
hard spend limit was found. The per-instance step limit and account creation
rate limit are technical ceilings, not a safe billing cap.

## Effective Date And Price Card

Cloudflare's [Workflows pricing page][workflow-pricing] and
[2026-07-07 changelog][workflow-billing-changelog] publish the following
Workers Paid rates:

| Dimension | Included per billing period | Overage |
| --- | ---: | ---: |
| Workflow invocations / Workers requests | 10 million per month | $0.30 per additional million |
| CPU time | 30 million CPU milliseconds per month | $0.02 per additional million CPU milliseconds |
| Persisted Workflow storage | 1 GB-month per month | $0.20 per additional GB-month |
| Workflow steps | 500,000 per month | $0.80 per additional 100,000 steps |

The same pages publish 3,000 steps per day and 1 GB-month of storage for
Workers Free. The changelog says Free-plan developers will not be charged
beyond those included amounts. The pricing page separately says a Free-plan
instance that attempts to persist state after reaching the storage limit
throws an error.

Cloudflare says:

- Workflows uses Workers Standard pricing for request and CPU usage;
- a Workflow invocation is the creation of a new Workflow instance;
- steps inside that instance are not additional invocations;
- subrequests made by the Workflow do not add request charges; and
- Workflow request and CPU charges share the Workers billing SKUs, so step and
  storage charges are additions rather than replacements.

As of this research date, Cloudflare's two official date statements are not
perfectly identical:

- the pricing page says billing "will apply starting August 10th, 2026";
- the changelog says billing will start "no earlier than August 10th, 2026"
  and promises no billing before that date.

Therefore 2026-08-10 should be treated as the earliest announced start, not as
proof that billing is active before Cloudflare confirms it in account billing.

## What Counts As A Step

The July changelog defines a billable step as each unit of work executed by a
Workflow and explicitly includes operations such as sleeping and waiting for
events. The public Workers API exposes the relevant durable operations:

- `step.do(...)`;
- `step.sleep(...)`;
- `step.sleepUntil(...)`; and
- `step.waitForEvent(...)`.

An important distinction exists between billing and authoring limits:
Cloudflare's API and limits documentation says `step.sleep` and
`step.sleepUntil` do not count toward the maximum steps-per-instance limit,
but the billing changelog explicitly includes sleeping in the billable step
definition. "Does not count toward the instance limit" must not be read as
"free."

Cloudflare's public documents do not clearly answer all attempt-level billing
questions:

- whether every failed `step.do` attempt is charged as one step;
- whether every automatic retry is an additional billable step;
- whether rollback attempts and rollback retries are charged separately; or
- how a timeout that never completes is represented in billable step totals.

The observability docs expose separate `STEP_*`, `ATTEMPT_*`, and
`ROLLBACK_*` events, but do not map those events to invoice units. The pricing
definition says "steps executed," which supports treating successful and
unsuccessful execution as cost risk, but it is not precise enough to publish
an exact retry multiplier.

Until Cloudflare documents the mapping, conservative forecasting should assume
retries and rollback work may add billable usage, then compare that estimate
with the Cloudflare billing dashboard. OpenMeld should not encode a contractual
retry formula from the current public text.

## Storage Meter, Retention, And Cleanup

Cloudflare describes Workflow storage as persisted Workflow state and meters it
in GB-months using the same method as Durable Objects SQL storage:

```text
GB-month = average of each day's peak persisted storage over a 30-day period
```

The storage total spans all Workflow instances and includes instances that are:

- running;
- errored;
- sleeping;
- completed and still within their retention period.

Relevant storage limits and behaviors:

- maximum persisted state per instance is 100 MB on Workers Free and 1 GB on
  Workers Paid;
- non-stream `step.do` results are limited to 1 MiB each;
- streamed step results can be larger and still count toward persisted state;
- completed instance state and logs are retained for 3 days on Free and 30
  days on Paid by default;
- `WorkflowInstanceCreateOptions.retention` can set shorter
  `successRetention` and `errorRetention` values when each instance is
  created; and
- deleting an instance through the Workers API, Wrangler, REST API, or the
  dashboard frees its storage, although the displayed storage limit may take a
  few minutes to update.

The retention options apply after successful completion or an
errored/terminated outcome. They do not make a still-running or sleeping
instance stateless. A long sleep remains durable and therefore retains its
state until it resumes or is deleted.

OpenMeld's selected policy for new Routine Workflow instances is one day after
successful completion and 30 days after an errored or terminated outcome.
Successful product truth already lives in D1 and the destination. Retaining
errors for the full paid-plan window preserves the existing operator-inspection
boundary for unknown failures and explicit termination while still removing
the normal successful-instance storage after one day.

The label "SQLite Storage" in the supplied screenshot should not be interpreted
as OpenMeld's application D1 storage. Cloudflare's public Workflows page says
the Workflow state meter is *priced identically to* Durable Objects SQL
storage. It does not say that a customer's D1 database and Workflow state are
the same storage allocation.

## Reconstructing The Supplied Estimate

The supplied X screenshot is not an official specification. It is useful only
as an example to apply the published price card.

For a Workers Paid account, the public formulas are:

```text
step overage =
  max(0, steps - 500,000) / 100,000 * $0.80

storage overage =
  max(0, GB-month - 1) * $0.20
```

Using the visible storage figure:

```text
(174,118.53 - 1) * $0.20 = $34,823.506
                                -> $34,823.51
```

That matches the screenshot's storage estimate exactly. Subtracting it from
the screenshot's $38,277.91 total leaves $3,454.40 for steps:

```text
$38,277.91 - $34,823.51 = $3,454.40
```

Storage is therefore about 90.98% of that example estimate; steps are about
9.02%. The headline risk in the screenshot is retained state volume, not just
the new per-step rate.

The reported 432,235,410-step figure does not reproduce the screenshot's step
subtotal exactly using the public formula:

```text
(432,235,410 - 500,000) / 100,000 * $0.80 = $3,453.88328
                                                   -> $3,453.88
```

That is $0.52 lower than the screenshot-implied $3,454.40. Possible reasons
include an unread digit in the screenshot, display rounding, billing-period
allocation, or an estimate rule not present in the public pricing page. This
small mismatch should remain explicit instead of being silently "corrected."
The storage calculation and the overall cost distribution are unaffected.

The screenshot also says its storage estimate assumes the observed SQL storage
is held for 30 days and does not model fluctuations. Actual billing, according
to the public pricing page, averages each day's peak storage.

## Monitoring And Spend Protection

Cloudflare documents these account-level controls:

1. **Billable Usage dashboard** — daily usage-overage cost by product and
   billing period. It is sourced from the billing system and is available to
   Pay-as-you-go accounts with Billing read permission.
2. **Budget alerts** — email notifications when cumulative account-wide
   usage-based spend crosses a dollar threshold. They are available to
   Pay-as-you-go accounts, fire once per threshold per billing period, and
   reset for the next billing period.
3. **Usage-based billing notifications** — product-metric notifications
   documented for Professional plans or higher on Pay-as-you-go accounts.
   The public page does not confirm a Workflow-step or Workflow-storage
   threshold option, so its usefulness for this specific meter must be checked
   in the account dashboard.

Budget alerts are explicitly informational. They do not stop Workflow creation,
pause instances, cap Workers usage, or cap the invoice.

The Workflows limits page provides useful blast-radius inputs, but not a spend
limit:

- Workers Paid defaults to 10,000 maximum steps per instance and can be
  configured up to 25,000;
- maximum creation rate is 300 instances per second per account and 100 per
  second per Workflow; and
- waiting instances do not consume a concurrency slot.

Those ceilings still permit very large monthly step and storage totals.
OpenMeld requires its own bounded schedule/run admission, state-size policy,
retention policy, and emergency engine-disable/rollback control if it wants a
real cost circuit breaker.

## What Must Be Verified Against OpenMeld

This vendor research alone cannot answer OpenMeld's bill risk. The repository
and live Cloudflare account must supply:

- which Routine Run engine is selected by default and in production;
- how many Cloudflare durable operations one normal, failed, and retried Run
  executes;
- the serialized size of Workflow input, each persisted step result, and the
  final output;
- the configured `successRetention` and `errorRetention` for new instances;
- the number, age, status, and storage footprint of existing instances;
- current Workflow step/storage estimates in the Cloudflare dashboard;
- whether Cloudflare has exposed Workflow-specific usage alerts to this
  account; and
- whether the Legacy engine avoids the Workflow meter without shifting the
  same cost into another paid Cloudflare product.

Use the Workflows dashboard and GraphQL analytics for operational drill-down,
but treat the Billable Usage dashboard and invoice as billing truth. The
Workflows analytics documentation says data is retained for 31 days and exposes
`stepCount`, yet its examples and field descriptions do not define a canonical
billable aggregation. Do not assume an application-side count matches the
invoice without reconciliation.

## Official Sources

- [Cloudflare Workflows pricing][workflow-pricing]
- [2026-07-07 Workflows billing changelog][workflow-billing-changelog]
- [Cloudflare Workers pricing][workers-pricing]
- [Cloudflare Workflows Workers API][workflow-api]
- [Cloudflare Workflows limits][workflow-limits]
- [Cloudflare Workflows metrics and analytics][workflow-metrics]
- [Cloudflare Billable Usage dashboard][billable-usage]
- [Cloudflare budget alerts][budget-alerts]
- [Cloudflare usage-based billing notifications][usage-billing]

[workflow-pricing]: https://developers.cloudflare.com/workflows/reference/pricing/
[workflow-billing-changelog]: https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/
[workers-pricing]: https://developers.cloudflare.com/workers/platform/pricing/#workflows
[workflow-api]: https://developers.cloudflare.com/workflows/build/workers-api/
[workflow-limits]: https://developers.cloudflare.com/workflows/reference/limits/
[workflow-metrics]: https://developers.cloudflare.com/workflows/observability/metrics-analytics/
[billable-usage]: https://developers.cloudflare.com/billing/manage/billable-usage/
[budget-alerts]: https://developers.cloudflare.com/billing/manage/budget-alerts/
[usage-billing]: https://developers.cloudflare.com/billing/understand/usage-based-billing/
