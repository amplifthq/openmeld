---
id: inbox-query-and-evidence-retention
title: Less database work for Inbox and safer history cleanup
kind: improved
areas: ["inbox", "agent-activity", "diagnostics"]
audiences: ["members", "operators"]
---

Inbox counts and grouped views use less database work while continuing to check
current access. Bulk read and removal still apply only to the view you selected.

Activity cleanup can process larger backlogs without double-counting sessions.
Old Wake diagnostics can expire without deleting in-progress work, recovery
records, or the records needed to honor a stop request.
