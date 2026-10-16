---
id: routines-navigation-and-team-sidebars
title: Open Routines directly from the main navigation
kind: improved
areas: ["web", "routines", "files"]
audiences: ["users"]
publishedAt: 2026-10-16
release: v0.3.263
evidence: ["commit:682d4fd273675b9dc405456a2c46a68aa24d8f4d", "commit:e7bcf2f444662ce4acc618d32354e378ce8df3fc"]
---

Routines has its own main navigation entry for personal and shared scheduled
work. Team keeps People, Agents, Files, Skills, and Plugins together.

Sidebars now match the page: People shows members, Agent details show the
current Agent list, and Files shows file locations. Skills, Plugins, and
Routines keep their own search and filters without an unrelated member list.

Spaces and Team sidebars share compact headings and collapse controls. Choosing
a file location returns to its root, and switching Agents preserves the return
path to the Agent directory.

Files keeps view, sort, filter, and search controls together on the left, with
New on the right. File destinations appear directly below the sidebar heading.

Spaces and People keep search in their sidebar options menu until needed, then
focus the revealed field. People options group computer filters in a submenu
and remove the five-minute activity filter. Sidebar icons and labels align with
their shared headings. A small Close search icon clears and hides the field;
Escape does the same and returns focus to the options button.

Newly pinned conversations appear first in Pinned, keeping the existing order
of other conversations. You can still drag pinned conversations to reorder them.
Smaller pinned avatars and a two-to-five-column grid fit more conversations
in the sidebar, including Spaces with multiple members.
