# .claude

Durable agent context for the auto-docs pipeline. The `/generate-docs` skill
and the `@claude` mention responder (`.github/workflows/claude.yml`) load
files in this directory before doing any work.

- `agents/docs-author.md` — the documentation author persona. Encodes the
  theme rules, MDX component conventions, voice, page shape, link rules,
  product positioning, and the locked sections of `docs.json`. Treat this
  file as the canonical writing standard. When the standard changes, edit
  this file and the change applies to every subsequent run.

- `commands/generate-docs.md` — the `/generate-docs` Claude Code skill.
  Run it from the auto-docs repo root in Claude Code (web or local):

  ```
  /generate-docs OpenGeometry
  /generate-docs OpenPlans
  /generate-docs OpenGeometry v2.3.0
  /generate-docs OpenPlans main all
  ```

  The skill clones the source repo, extracts the public API surface using
  `scripts/extract-api-surface.mjs`, and authors or updates the MDX pages
  under `<product>/` following the rules in `agents/docs-author.md`.

If you add a new agent (for example, a release-notes summarizer), add it as
`agents/<role>.md` and reference it from the workflow or skill that uses it.
