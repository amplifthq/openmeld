---
id: release-skill-history-and-cli-inputs
title: Catch Skill publication drift and invalid Computer selections earlier
kind: improved
areas: ["cli", "skills"]
audiences: ["users", "contributors"]
---

Release checks preserve signed Skill history and verify compatibility separately
from signature validity. Focused Skill tests prepare their package dependencies
automatically, including the supported Windows command launcher. Agent creation
now checks the selected Computer against the Organization inventory and explains
which ID to use when a record or Profile ID was supplied instead.
