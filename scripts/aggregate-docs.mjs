#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  config: "scripts/aggregation.config.json",
  outputDir: ".aggregated-site",
  tokenEnv: "PUSH_TOKEN",
  dryRun: false,
};

const ROOT_COPY_PATHS = ["index.mdx", "favicon.svg", ".mintignore", "mint.json", "logo", "images"];

function parseArgs(argv) {
  const args = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const [flag, inlineValue] = current.split("=", 2);

    if (flag === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (flag === "--config" || flag === "--output-dir" || flag === "--token-env") {
      const value = inlineValue ?? argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (!inlineValue) {
        i += 1;
      }
      if (flag === "--config") args.config = value;
      if (flag === "--output-dir") args.outputDir = value;
      if (flag === "--token-env") args.tokenEnv = value;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return args;
}

function runCommand(command, args, options = {}) {
  const safeArgs = args.map((value) =>
    typeof value === "string"
      ? value.replace(/x-access-token:[^@]+@/g, "x-access-token:***@")
      : value,
  );

  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      [
        `Command failed: ${command} ${safeArgs.join(" ")}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return (result.stdout || "").trim();
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function normalizeRoute(value) {
  return toPosix(value).replace(/^\/+/, "").replace(/\.mdx$/i, "").replace(/\/+$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectPagesFromNode(node, output = []) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPagesFromNode(item, output);
    }
    return output;
  }

  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "pages" && Array.isArray(value)) {
        for (const page of value) {
          if (typeof page === "string") {
            const normalized = normalizeRoute(page);
            if (normalized) {
              output.push(normalized);
            }
          }
        }
        continue;
      }
      collectPagesFromNode(value, output);
    }
  }

  return output;
}

async function listFilesRecursive(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath, extension)));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

function applyCompatibilityRewrites(line, targetFolder) {
  if (targetFolder !== "opengeometry") {
    return line;
  }

  let updated = line.replaceAll("/api-reference/export/projection", "/api/export/projection");
  updated = updated.replace(/\/api-reference(?=[)"'\s]|$)/g, "/api/primitives/line");
  return updated;
}

function prefixRootRelativeLinks(line, targetFolder) {
  const escapedTarget = escapeRegExp(targetFolder);

  return line
    .replace(new RegExp(`href="/(?!/|${escapedTarget}/)`, "g"), `href="/${targetFolder}/`)
    .replace(new RegExp(`src="/(?!/|${escapedTarget}/)`, "g"), `src="/${targetFolder}/`)
    .replace(new RegExp(`href='/(?!/|${escapedTarget}/)`, "g"), `href='/${targetFolder}/`)
    .replace(new RegExp(`src='/(?!/|${escapedTarget}/)`, "g"), `src='/${targetFolder}/`)
    .replace(new RegExp(`\\]\\(/(?!/|${escapedTarget}/)`, "g"), `](/${targetFolder}/`);
}

async function rewriteMdxFile(filePath, targetFolder) {
  const source = await readFile(filePath, "utf8");
  const lines = source.split("\n");
  let inCodeFence = false;

  const updated = lines
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      const withCompatibilityFixes = applyCompatibilityRewrites(line, targetFolder);
      return prefixRootRelativeLinks(withCompatibilityFixes, targetFolder);
    })
    .join("\n");

  if (updated !== source) {
    await writeFile(filePath, updated, "utf8");
  }
}

async function rewriteMdxLinks(targetDirectory, targetFolder) {
  const mdxFiles = await listFilesRecursive(targetDirectory, ".mdx");
  for (const filePath of mdxFiles) {
    await rewriteMdxFile(filePath, targetFolder);
  }
}

async function pruneUnreferencedMdx(targetDirectory, sourceDocsConfig) {
  const navPages = new Set(collectPagesFromNode(sourceDocsConfig.navigation ?? {}));
  const keepFiles = new Set();

  for (const page of navPages) {
    const relativeFilePath = `${page}.mdx`;
    const absolutePath = path.join(targetDirectory, relativeFilePath);
    if (existsSync(absolutePath)) {
      keepFiles.add(toPosix(relativeFilePath));
    }
  }

  const mdxFiles = await listFilesRecursive(targetDirectory, ".mdx");
  for (const mdxPath of mdxFiles) {
    const relativePath = toPosix(path.relative(targetDirectory, mdxPath));
    if (!keepFiles.has(relativePath)) {
      await rm(mdxPath, { force: true });
    }
  }
}

async function collectRoutes(targetDirectory) {
  const mdxFiles = await listFilesRecursive(targetDirectory, ".mdx");
  return new Set(
    mdxFiles.map((absoluteFile) => normalizeRoute(path.relative(targetDirectory, absoluteFile))),
  );
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  }
  return output;
}

function buildProductGroups({ sourceDocsConfig, availableRoutes, targetFolder }) {
  const tabs = Array.isArray(sourceDocsConfig?.navigation?.tabs)
    ? sourceDocsConfig.navigation.tabs
    : [];
  const prefixGroupWithTab = tabs.length > 1;
  const groups = [];

  for (const tab of tabs) {
    const tabLabel = typeof tab?.tab === "string" && tab.tab.trim() ? tab.tab.trim() : "Documentation";
    const tabGroups = Array.isArray(tab?.groups) ? tab.groups : [];

    for (const group of tabGroups) {
      const groupLabelRaw =
        typeof group?.group === "string" && group.group.trim() ? group.group.trim() : tabLabel;
      const pages = [];

      if (Array.isArray(group?.pages)) {
        for (const page of group.pages) {
          if (typeof page !== "string") {
            continue;
          }
          const normalized = normalizeRoute(page);
          if (!normalized || !availableRoutes.has(normalized)) {
            continue;
          }
          pages.push(`${targetFolder}/${normalized}`);
        }
      }

      const uniquePages = uniqueStrings(pages);
      if (uniquePages.length === 0) {
        continue;
      }

      const groupLabel = prefixGroupWithTab ? `${tabLabel} / ${groupLabelRaw}` : groupLabelRaw;
      groups.push({ group: groupLabel, pages: uniquePages });
    }
  }

  return groups;
}

function buildNavigation(baseConfig, sourceResults) {
  const tabs = [
    {
      tab: "Overview",
      groups: [
        {
          group: "OpenGeometry ecosystem",
          pages: ["index"],
        },
      ],
    },
  ];

  for (const result of sourceResults) {
    tabs.push({
      tab: result.source.product_tab_label,
      groups: buildProductGroups({
        sourceDocsConfig: result.sourceDocsConfig,
        availableRoutes: result.availableRoutes,
        targetFolder: result.source.target_folder,
      }),
    });
  }

  const navigation = { tabs };
  if (baseConfig?.navigation?.global) {
    navigation.global = baseConfig.navigation.global;
  }

  return navigation;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, content) {
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function copyRootAssets(workspaceRoot, outputDirectory) {
  for (const relativePath of ROOT_COPY_PATHS) {
    const sourcePath = path.join(workspaceRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const targetPath = path.join(outputDirectory, relativePath);
    const sourceStats = await stat(sourcePath);
    if (sourceStats.isDirectory()) {
      await cp(sourcePath, targetPath, { recursive: true });
    } else {
      await cp(sourcePath, targetPath);
    }
  }
}

function validateConfig(config) {
  if (!Array.isArray(config?.sources) || config.sources.length === 0) {
    throw new Error("Config must define a non-empty sources array.");
  }

  for (const source of config.sources) {
    const requiredFields = ["owner", "repo", "docs_subdirectory", "target_folder", "product_tab_label"];
    for (const field of requiredFields) {
      if (!source?.[field] || typeof source[field] !== "string") {
        throw new Error(`Missing required source field: ${field}`);
      }
    }
    if (source.clone_url && typeof source.clone_url !== "string") {
      throw new Error("source.clone_url must be a string when provided.");
    }
  }
}

function buildRepoUrl(source, token) {
  if (source.clone_url) {
    return source.clone_url;
  }

  const base = `${source.owner}/${source.repo}.git`;
  if (!token) {
    return `https://github.com/${base}`;
  }
  const encodedToken = encodeURIComponent(token);
  return `https://x-access-token:${encodedToken}@github.com/${base}`;
}

async function aggregateSource({ source, outputDirectory, token }) {
  const ref = source.ref || "main";
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "auto-docs-source-"));
  const cloneDirectory = path.join(tempRoot, "repo");

  try {
    const repoUrl = buildRepoUrl(source, token);

    console.log(`- Fetching ${source.owner}/${source.repo}@${ref} (${source.docs_subdirectory})`);
    runCommand("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--no-checkout",
      "--branch",
      ref,
      repoUrl,
      cloneDirectory,
    ]);
    runCommand("git", ["-C", cloneDirectory, "sparse-checkout", "init", "--cone"]);
    runCommand("git", ["-C", cloneDirectory, "sparse-checkout", "set", source.docs_subdirectory]);
    runCommand("git", ["-C", cloneDirectory, "checkout", ref]);

    const docsDirectory = path.join(cloneDirectory, source.docs_subdirectory);
    if (!existsSync(docsDirectory)) {
      throw new Error(`Missing docs directory in source repo: ${source.docs_subdirectory}`);
    }

    const targetDirectory = path.join(outputDirectory, source.target_folder);
    await rm(targetDirectory, { recursive: true, force: true });
    await cp(docsDirectory, targetDirectory, { recursive: true });

    const sourceDocsPath = path.join(targetDirectory, "docs.json");
    if (!existsSync(sourceDocsPath)) {
      throw new Error(`Source docs.json not found at ${source.target_folder}/docs.json`);
    }

    const sourceDocsConfig = await readJson(sourceDocsPath);
    await pruneUnreferencedMdx(targetDirectory, sourceDocsConfig);
    await rewriteMdxLinks(targetDirectory, source.target_folder);
    const availableRoutes = await collectRoutes(targetDirectory);

    return { source, sourceDocsConfig, availableRoutes };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = process.cwd();
  const configPath = path.resolve(workspaceRoot, args.config);
  const outputDirectory = args.dryRun
    ? await mkdtemp(path.join(os.tmpdir(), "auto-docs-dry-run-"))
    : path.resolve(workspaceRoot, args.outputDir);
  const token = process.env[args.tokenEnv] || "";

  const config = await readJson(configPath);
  validateConfig(config);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  console.log(`Aggregating docs into ${outputDirectory}`);
  await copyRootAssets(workspaceRoot, outputDirectory);

  const sourceResults = [];
  for (const source of config.sources) {
    sourceResults.push(await aggregateSource({ source, outputDirectory, token }));
  }

  const docsBasePath = path.join(workspaceRoot, "docs.base.json");
  if (!existsSync(docsBasePath)) {
    throw new Error("docs.base.json is missing.");
  }

  const docsBase = await readJson(docsBasePath);
  const navigation = buildNavigation(docsBase, sourceResults);
  const rootDocsJson = { ...docsBase, navigation };
  await writeJson(path.join(outputDirectory, "docs.json"), rootDocsJson);

  console.log("Aggregation complete.");
  if (args.dryRun) {
    console.log(`Dry-run output: ${outputDirectory}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
