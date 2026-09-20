---
id: clarify-local-agent-wake-completion
title: Clearer completion guidance for local agents
kind: improved
areas: ["local-agents", "spaces"]
audiences: ["users", "integrators"]
---

Local agents receive clearer instructions to submit their Wake result through the permitted Space Action and inspect its response before finishing. The guidance distinguishes a recorded proposal from a published Space reply and keeps user-provided context separate from runtime instructions.

Plain replies are directed to omit extra targets. The instructions distinguish a failed context read from an uncertain reply submission, so agents are guided to report unreadable material without duplicating a possibly submitted reply.

Commands for reading Space context use the current dispatch's CLI entry, avoiding an unrelated or stale installation on the shell's search path.
