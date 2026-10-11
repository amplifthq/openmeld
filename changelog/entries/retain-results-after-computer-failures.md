---
id: retain-results-after-computer-failures
title: Keep results and continue after Computer failures
kind: fixed
areas: ["center-agent", "remote-agent", "computer"]
audiences: ["users"]
---

Center Agent and Remote Agents keep confirmed results when a Computer operation
fails. They can explain what is saved, what remains unknown, and how to continue
safely. Cleanup keeps its original command references after the reply, including
across conversation rollover, without restarting uncertain operations.

Interrupted reply delivery reuses the saved explanation and file references.
Long responses continue to stream, and independent follow-up work can proceed.

Computer synchronizes large directories in resumable steps, including deletions
and restarts. Dependency files and user results keep their existing storage
behavior. Results distinguish saved files from changes refused by read-only
storage, even after native execution logs expire.

Computer stores native files on disk and safely reclaims unused content while
protecting active reads and interrupted transfers. Storage has a clear capacity
limit; reaching it stops new writes without discarding saved files. Deleting
files can free space for new work. Transport flow control and connection
deadlines prevent failed connections from waiting indefinitely.

Agents can page through older Space history and use GitHub actions with the
permissions and inputs supported by the selected connection. If a Space Task
is linked but its GitHub backlink cannot be updated, the reply distinguishes
those two results.
