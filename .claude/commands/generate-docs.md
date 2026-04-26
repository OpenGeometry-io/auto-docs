You are the OpenGeometry documentation author. Read `.claude/agents/docs-author.md`
fully before doing anything else — it defines the writing rules, MDX conventions,
page shape, and voice you must follow. Treat that file as inviolable.

## Arguments

`$ARGUMENTS` has the form: `<product> [ref] [scope]`

- `product` (required): `OpenGeometry` or `OpenPlans`
- `ref` (optional): branch, tag, or SHA to check out in the source repo. Omit to use the default branch HEAD.
- `scope` (optional): `api` (default) or `all`.
  - `api` — only touch `<product>/api/**` and the api groups inside `docs.json`.
  - `all` — may also revisit `concepts/`, `guides/`, and `examples/` pages when the source contradicts them.

Examples:
- `/generate-docs OpenGeometry`
- `/generate-docs OpenPlans main all`
- `/generate-docs OpenGeometry v2.3.0`

If no product is given, ask the user before proceeding.

## Steps

Follow these steps in order. Do not skip any step.

### 1 — Parse arguments

Extract `PRODUCT`, `REF` (default: empty string), and `SCOPE` (default: `api`) from `$ARGUMENTS`.

Validate that `PRODUCT` is one of `OpenGeometry` or `OpenPlans`. If it is not, stop and tell the user.

Set `SOURCE_REPO` based on the product:
- `OpenGeometry` → `https://github.com/OpenGeometry-io/OpenGeometry.git`
- `OpenPlans` → `https://github.com/OpenGeometry-io/OpenPlans.git`

Set `SOURCE_DIR` to `/tmp/og-source-${PRODUCT}`.
Set `SURFACE_PATH` to `/tmp/og-api-surface-${PRODUCT}.json`.

### 2 — Clone the source repo

Check whether `SOURCE_DIR` already exists and its remote matches `SOURCE_REPO`. If it does, run a fast-forward fetch instead of a full clone. Otherwise clone fresh (depth 1):

```bash
# fresh clone (shallow)
git clone --depth=1 <SOURCE_REPO> <SOURCE_DIR>
# or, if REF is set:
git clone --depth=1 --branch <REF> <SOURCE_REPO> <SOURCE_DIR>
```

If the clone fails (private repo, network error), stop and tell the user with the error output.

### 3 — Install extractor dependencies

```bash
cd scripts && npm ci --prefer-offline 2>&1 || npm install --no-audit --no-fund 2>&1
```

Run this from the repo root (the `auto-docs` working directory).

### 4 — Extract the public API surface

```bash
node scripts/extract-api-surface.mjs \
  --product=<PRODUCT> \
  --source=<SOURCE_DIR> \
  --out=<SURFACE_PATH>
```

If extraction fails, report the error and stop. Do not attempt to author docs without a surface file.

### 5 — Read the persona and current state

- Read `.claude/agents/docs-author.md` (the inviolable rule set).
- Read `docs.json` to understand the current navigation for `PRODUCT`.
- List all existing MDX files under `<PRODUCT>/`.
- Read `<SURFACE_PATH>` to understand what the source currently exports.

### 6 — Author or update the docs

Apply the rules in `docs-author.md`. Specifically:

- **New exports** not covered by any existing MDX page → create a new page in the correct folder and add it to `docs.json` navigation.
- **Removed exports** whose page still exists → delete the page and remove it from `docs.json` navigation.
- **Changed signatures** (parameters, return types, property types) → update the relevant `<ParamField>` / `<ResponseField>` blocks and the code examples.
- **Unchanged narrative sections** (Overview, Use Cases, See Also, Live Demo) → preserve them as-is unless they contradict the source.

If `SCOPE` is `api`, do not touch `concepts/`, `guides/`, or `examples/` pages.

If `SCOPE` is `all`, you may update concept and guide pages when the source changes contradict them — but preserve hand-curated prose that is still accurate.

### 7 — Print a summary

At the end, print a concise Markdown summary (under 60 lines) covering:

- Pages added (with paths).
- Pages updated (with paths and a one-line reason each).
- Pages removed (with paths and a one-line reason each).
- Navigation changes in `docs.json`.
- Any rule you considered but deliberately did not apply, with a one-sentence justification.
