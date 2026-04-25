# .claude

Durable agent context for the auto-docs pipeline. Both
`.github/workflows/generate-docs.yml` (programmatic) and
`.github/workflows/claude.yml` (`@claude` mention responder) load files in
this directory before doing any work.

- `agents/docs-author.md` — the documentation author persona. Encodes the
  theme rules, MDX component conventions, voice, page shape, link rules,
  product positioning, and the locked sections of `docs.json`. Treat this
  file as the canonical writing standard. When the standard changes, edit
  this file and the change applies to every subsequent run.

If you add a new agent (for example, a release-notes summarizer), add it as
`agents/<role>.md` and reference it from the workflow that uses it.
