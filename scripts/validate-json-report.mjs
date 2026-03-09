#!/usr/bin/env node

import path from "node:path";
import { defaultEntryId, defaultSchemaPath, validateFiles } from "../src/validation.mjs";

function parseArgs(argv) {
    const args = {
        schemaPath: defaultSchemaPath,
        entryId: defaultEntryId,
        dataPaths: []
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--schema") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --schema");
            }
            args.schemaPath = path.resolve(process.cwd(), value);
        } else if (arg === "--entry-id") {
            const value = argv[++i];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --entry-id");
            }
            args.entryId = value;
        } else if (arg === "--help" || arg === "-h") {
            args.help = true;
        } else {
            args.dataPaths.push(path.resolve(process.cwd(), arg));
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/validate-json-report.mjs [options] <json-file> [more-json-files...]

Options:
  --schema <path>    Path to the compound schema bundle
                     Default: generated/component.compound.schema.json
  --entry-id <id>    Schema id to use as the validation entrypoint
                     Default: urn:edatasheets:component-compound-schema
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.dataPaths.length === 0) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    const result = await validateFiles({
        dataPaths: args.dataPaths,
        schemaPath: args.schemaPath,
        entryId: args.entryId
    });

    console.log(JSON.stringify(result.results.length === 1 ? result.results[0] : { results: result.results }, null, 2));
    process.exit(result.valid ? 0 : 1);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
