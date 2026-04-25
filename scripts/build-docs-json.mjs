#!/usr/bin/env node
// Reserved. The first iteration of the pipeline lets the docs author agent
// edit docs.json under tight constraints. If the agent drifts on navigation
// shape, replace the agent step in generate-docs.yml with a deterministic
// build of docs.json from each product's .atlas-analysis.json.
//
// The plan when implemented:
//   1. Read auto-docs/docs.json. Preserve theme, colors, navbar, footer,
//      contextual, integrations, seo, metadata, logo, favicon.
//   2. For each product folder (OpenGeometry/, OpenPlans/), read its
//      .atlas-analysis.json (or its replacement) and translate the
//      navigation.tabs entries into navigation.products[*].tabs entries,
//      prefixing every page slug with `<Product>/`.
//   3. Write docs.json back with two-space indent.

process.stderr.write('build-docs-json.mjs is reserved. See file header.\n');
process.exit(0);
