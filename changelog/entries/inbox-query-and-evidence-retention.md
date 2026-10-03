---
id: inbox-query-and-evidence-retention
title: Less database work for Inbox and safer history cleanup
kind: improved
areas: ["inbox", "agent-activity", "diagnostics"]
audiences: ["members", "operators"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1457", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "workflow:37043210339", "workflow:37044018284", "commit:60509153ca78fd785360206369f803b6f5b58f7d"]
---

Inbox counts and grouped views use less database work while continuing to check
current access. Bulk read and removal still apply only to the view you selected.
Collapsed update groups now share the same subtle hover highlight as Inbox items.

Activity cleanup can process larger backlogs without double-counting sessions.
Old Wake diagnostics can expire without deleting in-progress work, recovery
records, or the records needed to honor a stop request.
