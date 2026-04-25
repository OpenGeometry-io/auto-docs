# auto-docs scripts

Utilities used by `.github/workflows/generate-docs.yml`. Run from this folder
so `node_modules` resolves locally.

## extract-api-surface.mjs

Reads a product source repository and emits a stable JSON snapshot of its
public TypeScript API surface. The headless docs agent consumes this snapshot
as the source of truth for what to document.

```bash
node extract-api-surface.mjs \
  --product=OpenGeometry \
  --source=/path/to/cloned/source/repo \
  --out=/tmp/api-surface.json
```

The script understands two product layouts today:

- **OpenGeometry** — entry points are `main/opengeometry-three/index.ts` and
  `main/opengeometry-three/src/**`. The Rust core is intentionally not
  documented page-per-symbol; its surface is wrapped by the TS layer that
  users actually consume.
- **OpenPlans** — entry point is `src/index.ts`.

If you add another product, extend `PRODUCT_LAYOUTS` in the script.

Output shape:

```jsonc
{
  "product": "OpenGeometry",
  "sourceRepo": "OpenGeometry-io/OpenGeometry",
  "extractedAt": "2026-04-25T12:34:56.000Z",
  "entryFiles": ["main/opengeometry-three/index.ts"],
  "exports": [
    {
      "name": "Cuboid",
      "kind": "class",
      "file": "main/opengeometry-three/src/shapes/cuboid.ts",
      "line": 42,
      "jsdoc": "Cuboid backed by the kernel BREP…",
      "signature": "class Cuboid extends THREE.Mesh { … }",
      "members": [ /* methods, properties, with their own signatures + jsdoc */ ]
    }
  ]
}
```

## summarize-surface.mjs

Produces a short Markdown digest of the extracted surface for the PR body.
Given the JSON file as its only argument, prints to stdout:

```
## API surface
- 17 classes
- 23 functions
- 4 type aliases
```

## build-docs-json.mjs

Reserved for a follow-up. The current pipeline lets the docs author agent
edit `docs.json` directly within the constraints encoded in
`.claude/agents/docs-author.md`. If the rules drift, swap the agent step for
a deterministic builder that reads `.atlas-analysis.json` from each product
repo and rebuilds the navigation tree.
