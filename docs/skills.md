# Development skills

Updated on 29 October 2026. These skills help Codex develop and maintain Finance
Billing; they add no dependencies or internet requirement to the installed app.

There are 42 user-installed skills in each location:

- Global: `%USERPROFILE%\.codex\skills`, available across projects.
- Project: `D:\app\.codex\skills`, versioned with this project.

All 37 previously installed Matt Pocock skills were checked against upstream:
13 had changes and 24 were already current. The five additions below were
discovered through [skills.sh](https://www.skills.sh/) and installed from their
upstream GitHub repositories at fixed commits. Global and project copies match
byte for byte, including the supporting reference files.

| Added skill | Purpose for this app | Directory listing |
| --- | --- | --- |
| `vercel-react-best-practices` | Responsive bill forms, efficient rendering, and React/Next.js performance | [Vercel React best practices](https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) |
| `vercel-composition-patterns` | Maintainable form, account, report, and delivery components | [Vercel composition patterns](https://www.skills.sh/vercel-labs/agent-skills/vercel-composition-patterns) |
| `next-best-practices` | App Router conventions, server/client boundaries, route handlers, and bundling | [Next.js best practices](https://www.skills.sh/vercel-labs/openreview/next-best-practices) |
| `web-design-guidelines` | Accessibility, keyboard interaction, and interface reviews | [Web design guidelines](https://www.skills.sh/vercel-labs/agent-skills/web-design-guidelines) |
| `frontend-design` | Intentional typography, layout, and visual consistency | [Frontend design](https://www.skills.sh/anthropics/skills/frontend-design) |

## Versions and scope

[The lock file](../.codex/skills-lock.json) records each repository, source path,
exact commit, file count, and content fingerprint. Source files are installed
unchanged, including upstream metadata and references. The directory names for
Vercel React and composition skills match their declared skill names.

The application currently resolves Next.js 15.5.27, React 19.3.0, and Vitest 3.2.7.
Apply guidance that matches the installed versions. For example, Next.js 16's
`proxy` convention does not replace this project's Next.js 15 middleware.
Existing offline storage, local fonts/assets, Electron process boundaries, and
user-approved behavior remain the project requirements. Installing a skill does
not authorize a framework migration, UI redesign, cloud deployment, or dependency
upgrade.

The current antfu Vitest skill targets Vitest 5.1 beta and was not installed for
this Vitest 3 project. Its existing `tdd` and `diagnosing-bugs` skills were refreshed.
The pnpm skill targets versions 11/12 and was also left out to avoid applying new
configuration assumptions to this project's existing tooling. Unrelated cloud,
deployment, React Native, and low-signal desktop/database skills were not added.

The Web Interface Guidelines skill fetches upstream rules when a developer runs
a review; it does not add a network dependency to Finance Billing. Existing
Codex-managed `.system` skills and bundled plugin skills are maintained by Codex
and were left in place. No Cursor plugin repository was installed.

## Backups and verification

The 37 previous global and project skill folders are saved under
`D:\app\backups\skills-20261029-120023\global` and `project`. The same backup
contains `audit-before.json` and `verification.json`.

Verification checked all 42 skills' names and descriptions, supporting files,
content fingerprints, both installation locations, and the old-folder backups.
Upstream illustrative links to example application files are retained. Three
relative links in Vercel's compiled `AGENTS.md` refer to rule files located in its
`rules` folder; those rule files are included and can be opened there.

Skills are available to Codex on the next turn. The desktop billing app does not
need to be rebuilt or restarted for this change.
