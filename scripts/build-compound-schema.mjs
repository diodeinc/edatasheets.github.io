#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const partSpecDir = path.join(cwd, "part-spec");
const defaultOutput = path.join(cwd, "generated", "component.compound.schema.json");
const defaultEntryId =
    "https://github.com/edatasheets/edatasheets.github.io/blob/main/part-spec/component.json";
const defaultBundleId = "urn:edatasheets:component-compound-schema";

function parseArgs(argv) {
    const args = {
        output: defaultOutput,
        entryId: defaultEntryId,
        bundleId: defaultBundleId
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--output") {
            args.output = path.resolve(cwd, argv[++i]);
        } else if (arg === "--entry-id") {
            args.entryId = argv[++i];
        } else if (arg === "--bundle-id") {
            args.bundleId = argv[++i];
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function walkJsonFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkJsonFiles(fullPath, out);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
            out.push(fullPath);
        }
    }
    return out;
}

function makeDefKey(filePath) {
    return path.relative(partSpecDir, filePath).replace(/\\/g, "/").replace(/\.json$/, "").replace(/\//g, "__");
}

function buildBundle({ output, entryId, bundleId }) {
    const files = walkJsonFiles(partSpecDir).sort();
    const defs = {};
    let foundEntryId = false;

    for (const file of files) {
        const schema = JSON.parse(fs.readFileSync(file, "utf8"));
        if (schema.$id === entryId) {
            foundEntryId = true;
        }
        defs[makeDefKey(file)] = schema;
    }

    if (!foundEntryId) {
        throw new Error(`Entry schema id not found: ${entryId}`);
    }

    const bundle = {
        $id: bundleId,
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "edatasheets compound schema bundle",
        $comment: "Generated from the local part-spec schema tree.",
        $ref: entryId,
        $defs: defs
    };

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(bundle, null, 4) + "\n");

    return { output, fileCount: files.length };
}

try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildBundle(args);
    console.log(`Wrote ${result.fileCount} schemas to ${path.relative(cwd, result.output)}`);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
