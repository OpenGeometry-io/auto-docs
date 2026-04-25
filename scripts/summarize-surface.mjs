#!/usr/bin/env node
// Render a short Markdown digest of an api-surface.json file. Output is used
// in the auto-generated PR body so reviewers see the shape of what changed
// before reading the diff.

import fs from 'node:fs';
import process from 'node:process';

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('usage: summarize-surface.mjs <api-surface.json>\n');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const counts = new Map();
  for (const exp of data.exports || []) {
    counts.set(exp.kind, (counts.get(exp.kind) || 0) + 1);
  }

  const lines = [];
  lines.push(`### Public API surface (${data.product})`);
  lines.push('');
  lines.push(`- Source: \`${data.sourceRepo}\``);
  lines.push(`- Entry files: ${data.entryFiles.map((f) => `\`${f}\``).join(', ')}`);
  lines.push(`- Total exports: **${data.exports.length}**`);
  if (counts.size > 0) {
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [kind, n] of ordered) {
      lines.push(`  - ${n} ${kind}${n === 1 ? '' : 's'}`);
    }
  }
  lines.push('');

  // Top-level export names, capped so the PR body stays readable.
  const names = (data.exports || []).map((e) => e.name);
  const cap = 50;
  if (names.length > 0) {
    lines.push('<details><summary>Exported names</summary>');
    lines.push('');
    lines.push(names.slice(0, cap).map((n) => `\`${n}\``).join(', ') + (names.length > cap ? `, +${names.length - cap} more` : ''));
    lines.push('');
    lines.push('</details>');
  }

  process.stdout.write(lines.join('\n') + '\n');
}

main();
