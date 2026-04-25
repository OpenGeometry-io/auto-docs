#!/usr/bin/env node
// Extract a stable JSON snapshot of a product's public TypeScript API surface.
// Output drives the headless docs author agent so it has structured input
// instead of grepping a cold repository.
//
// Usage:
//   node extract-api-surface.mjs --product=OpenGeometry \
//                                --source=/path/to/source \
//                                --out=/tmp/api-surface.json

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const PRODUCT_LAYOUTS = {
  OpenGeometry: {
    sourceRepo: 'OpenGeometry-io/OpenGeometry',
    entryFiles: [
      'main/opengeometry-three/index.ts',
    ],
    extraGlobs: [
      'main/opengeometry-three/src/**/*.ts',
    ],
    rootTsConfig: 'main/opengeometry-three/tsconfig.json',
  },
  OpenPlans: {
    sourceRepo: 'OpenGeometry-io/OpenPlans',
    entryFiles: [
      'src/index.ts',
    ],
    extraGlobs: [
      'src/**/*.ts',
    ],
    rootTsConfig: 'tsconfig.json',
  },
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`extract-api-surface: ${msg}\n`);
  process.exit(1);
}

function readTsConfig(sourceDir, configRel) {
  const configPath = path.join(sourceDir, configRel);
  if (!fs.existsSync(configPath)) return null;
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) return null;
  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    path.dirname(configPath),
  );
  return parsed;
}

function firstJsDocText(node) {
  const docs = ts.getJSDocCommentsAndTags(node);
  if (!docs || docs.length === 0) return null;
  // Prefer the comment text of the first JSDoc block.
  for (const d of docs) {
    if (d.kind === ts.SyntaxKind.JSDoc) {
      const text = typeof d.comment === 'string'
        ? d.comment
        : (d.comment ?? []).map((c) => c.text || '').join('');
      if (text) return text.trim();
    }
  }
  return null;
}

function nodeKindLabel(node) {
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableStatement(node)) return 'variable';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  return 'other';
}

function signatureFor(node, sourceFile) {
  // Use the printer to produce a stable, single-line-ish signature without
  // bodies. We strip the function/class body for compactness.
  const printer = ts.createPrinter({ removeComments: true });
  let cloned = node;
  if (ts.isClassDeclaration(node)) {
    cloned = ts.factory.updateClassDeclaration(
      node,
      node.modifiers,
      node.name,
      node.typeParameters,
      node.heritageClauses,
      [], // drop members from the top-level signature; we list members separately
    );
  } else if (ts.isFunctionDeclaration(node)) {
    cloned = ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      undefined,
    );
  }
  try {
    return printer
      .printNode(ts.EmitHint.Unspecified, cloned, sourceFile)
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return node.getText(sourceFile).split('\n')[0].trim();
  }
}

function collectClassMembers(node, sourceFile, sourceDir) {
  const members = [];
  for (const m of node.members) {
    // Only public, named members.
    const flags = ts.getCombinedModifierFlags(m);
    const isPrivate = flags & ts.ModifierFlags.Private;
    const isProtected = flags & ts.ModifierFlags.Protected;
    if (isPrivate || isProtected) continue;

    const name = m.name && ts.isIdentifier(m.name) ? m.name.text
      : m.name && ts.isStringLiteral(m.name) ? m.name.text
      : null;
    if (!name) continue;
    if (name.startsWith('_')) continue;

    const memberKind = ts.isMethodDeclaration(m) ? 'method'
      : ts.isPropertyDeclaration(m) ? 'property'
      : ts.isGetAccessor(m) ? 'getter'
      : ts.isSetAccessor(m) ? 'setter'
      : ts.isConstructorDeclaration(m) ? 'constructor'
      : 'other';

    const printer = ts.createPrinter({ removeComments: true });
    let signatureNode = m;
    if (ts.isMethodDeclaration(m)) {
      signatureNode = ts.factory.updateMethodDeclaration(
        m,
        m.modifiers,
        m.asteriskToken,
        m.name,
        m.questionToken,
        m.typeParameters,
        m.parameters,
        m.type,
        undefined,
      );
    }
    let signature;
    try {
      signature = printer
        .printNode(ts.EmitHint.Unspecified, signatureNode, sourceFile)
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      signature = m.getText(sourceFile).split('\n')[0].trim();
    }

    members.push({
      name,
      kind: memberKind,
      signature,
      jsdoc: firstJsDocText(m),
      file: path.relative(sourceDir, sourceFile.fileName),
      line: sourceFile.getLineAndCharacterOfPosition(m.getStart(sourceFile)).line + 1,
    });
  }
  return members;
}

function extractFromProgram(program, sourceDir) {
  const checker = program.getTypeChecker();
  const exports = [];
  const seen = new Set();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(sourceDir)) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    const symbol = checker.getSymbolAtLocation(sourceFile);
    if (!symbol) continue;
    const moduleExports = checker.getExportsOfModule(symbol);

    for (const exp of moduleExports) {
      const decls = exp.getDeclarations() || [];
      for (const decl of decls) {
        // Walk through re-exports: if the declaration is in another file,
        // only record it when we visit that file.
        if (decl.getSourceFile() !== sourceFile) continue;
        const name = exp.getName();
        const dedupeKey = `${name}@${path.relative(sourceDir, sourceFile.fileName)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const kind = nodeKindLabel(decl);
        const entry = {
          name,
          kind,
          file: path.relative(sourceDir, sourceFile.fileName),
          line: sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1,
          jsdoc: firstJsDocText(decl),
          signature: signatureFor(decl, sourceFile),
        };
        if (ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl)) {
          entry.members = collectClassMembers(decl, sourceFile, sourceDir);
        }
        exports.push(entry);
      }
    }
  }

  // Stable sort: by file, then by line.
  exports.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return exports;
}

function main() {
  const args = parseArgs(process.argv);
  const product = args.product;
  const sourceDirArg = args.source;
  const outPath = args.out;

  if (!product) die('missing --product');
  if (!sourceDirArg) die('missing --source');
  if (!outPath) die('missing --out');

  const layout = PRODUCT_LAYOUTS[product];
  if (!layout) die(`unknown product '${product}'. Add it to PRODUCT_LAYOUTS.`);

  const sourceDir = path.resolve(sourceDirArg);
  if (!fs.existsSync(sourceDir)) die(`source directory does not exist: ${sourceDir}`);

  const entries = layout.entryFiles
    .map((rel) => path.join(sourceDir, rel))
    .filter((p) => {
      if (!fs.existsSync(p)) {
        process.stderr.write(`extract-api-surface: entry not found, skipping: ${p}\n`);
        return false;
      }
      return true;
    });
  if (entries.length === 0) die('no entry files found for product layout');

  // Build a TS program rooted at the product's tsconfig (when available) so
  // module resolution and lib target match the source repo.
  let parsed = readTsConfig(sourceDir, layout.rootTsConfig);
  let compilerOptions = parsed?.options || {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: false,
    skipLibCheck: true,
    noEmit: true,
  };
  // Force noEmit and skipLibCheck for the extractor.
  compilerOptions = { ...compilerOptions, noEmit: true, skipLibCheck: true };

  const program = ts.createProgram({
    rootNames: entries,
    options: compilerOptions,
  });

  const exports = extractFromProgram(program, sourceDir);
  const out = {
    product,
    sourceRepo: layout.sourceRepo,
    extractedAt: new Date().toISOString(),
    entryFiles: layout.entryFiles,
    exports,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  process.stderr.write(`extract-api-surface: wrote ${exports.length} exports to ${outPath}\n`);
}

main();
