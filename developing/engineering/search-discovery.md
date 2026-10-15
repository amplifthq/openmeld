# Search discovery and launch checks

## Agent Context

- Purpose: Tie search and answer-engine discovery work to a useful first task.
- Read this when: Preparing a public announcement or changing public search entry points.
- Update this when: Public URLs, first-task paths, measurement access, or distribution rules change.
- Do not use this for: Deployment, private analytics records, ranking promises, or bulk content generation.
- Source of truth: Search acceptance and launch measurement; Website, Docs, and product owners retain implementation contracts.

## Stage and priority

Public source and reachable pages do not mean a formal launch has occurred.
Before the first announcement, prioritize crawlable pages, accurate answers,
and a working first task. A source change is not proof of deployment,
indexing, traffic, or an answer-engine citation.

1. Release reviewed changes through the [production release owner](production-release.md).
2. Check the deployed URLs below and the real new-user path.
3. Record a baseline using existing authorized analytics and Search Console.
   Mark unavailable measurements as unknown.
4. Share the product after the first task works. Use actual user questions and
   failures to decide which content to add next.

## Public acceptance

| Surface | Acceptance |
| --- | --- |
| Website root | 200; product title and canonical; FAQ answers in initial HTML; FAQ pointer and keyboard operation work |
| Website robots | Required CSS and JavaScript under `/_website/assets/` are allowed; server functions remain excluded; sitemap is listed |
| Website sitemap | 200 XML; only canonical public pages, each returning 200 without a login |
| Docs sitemap | 200 XML; guides and self-hosting page appear |
| Docs content | HTML, Markdown, and LLM views agree; internal links work; no private data or invented capabilities |
| Root `/llms.txt` | Existing App-owned protocol works; summary and links match public documentation |
| Auth routes | Login, sign-up, forgot-password, reset-password, magic-link, check-email, verify-email have noindex and task-specific titles |
| Preview Website HTML | `X-Robots-Tag: noindex, nofollow`; production public pages remain indexable |
| Preview Docs | Existing nonproduction noindex policy remains intact |
| Legacy guides | Redirect to the same supported documentation pages |
| Missing URL | Actual 404, not a successful generic application shell |

Inspect raw HTML and headers as well as the rendered browser. Robots rules
are not access control. Do not block auth pages in robots.txt when crawlers
must read their noindex directive. Do not extend auth-page noindex to public
protocols or shared pages.

For a new user, follow the public app link, create or sign in to an account,
ask the cloud Center Agent one small question, and confirm a visible result.
Local installation is optional for this first task. Test a local-agent task
separately before claiming that connection works. Record the deployed revision,
time, path, and result; redact account data. A local preview does not prove
production sign-in or task execution.

## Questions and page owners

Use one useful answer per intent. Keep guide URLs stable.

| User question | Existing answer |
| --- | --- |
| What is OpenMeld, and why use it with an agent? | Website product explanation and FAQ |
| Can I try it without installing anything? | `/docs/start/quickstart` |
| How do I use Codex or Claude Code with my team? | Their pages under `/docs/start/local-agents/` |
| Can I connect my existing Grok Bot? | Grok Bot guide, including shared-conversation and Stop limits |
| How do Grok Build, OpenCode, Antigravity, and Cursor CLI connect? | Their separate local-agent guides |
| Does my computer need to stay on? | Website FAQ and connect-computer guide |
| Does local execution keep all data on my computer? | Data-storage and private-information guides |
| Is open source the same as supported self-hosting? | `/docs/security-and-privacy/self-hosting` |

Do not add near-duplicate keyword pages, unsupported comparisons, fabricated
testimonials, or special schema solely to seek AI citations. Keep machine
readable views derived from the same public content. The root protocol remains
App-owned; the documentation index remains Docs-owned.

## Measurement record

Keep dated results in an authorized analytics workspace or private local
record, not public source. Use the same definitions before and after launch.
Unknown is not zero.

| Measure | Record |
| --- | --- |
| Release identity | Deployed SHA, component, date, and public URL checked |
| Search coverage | Search Console property, sitemap submission, inspected URLs, exclusions |
| Search demand | Impressions, clicks, actual queries; compare equivalent periods |
| Visit source | Existing referrer or campaign attribution, where available |
| First value | Sign-ups and first successful task from existing authorized evidence; state attribution gaps |
| Answer visibility | Exact question, engine, date, answer, cited URL, factual errors |
| Support friction | First-task failures and repeated setup questions; remove personal data |

Check at launch, after 48 hours, and after one week. These are manual review
points, not an automatic monitor. Small samples are directional. A citation
does not prove a user completed a task. Do not add tracking or transmit account
identifiers just to fill measurement gaps.

## Distribution

Choose a few relevant communities where the product can be tried. Show a real
working example and present limits. Link to the relevant guide when answering
a real question. Do not buy links, mass-submit directories, or coordinate votes.

For Show HN, confirm visitors can try something useful. The human author must
write the submission and comments under the current
[HN guidelines](https://news.ycombinator.com/newsguidelines.html) and
[Show HN rules](https://news.ycombinator.com/showhn.html). Do not publish generated
or AI-edited text there. Channel selection is not authorization to post.

## References

- [Google: AI features](https://developers.google.com/search/docs/appearance/ai-features):
  normal search eligibility and useful content remain the foundation; no special AI file or schema is required.
- [Google: robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro):
  allow resources needed to render pages; robots exclusions are not noindex.
- [Google: block indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing):
  crawlers must be able to read the noindex directive.

Recheck external guidance before a later launch. These checks improve readiness;
they do not guarantee indexing, rankings, traffic, or citations.
