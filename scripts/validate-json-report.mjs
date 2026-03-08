#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const defaultSchemaPath = path.join(cwd, "generated", "component.compound.schema.json");
const defaultEntryId = "urn:edatasheets:component-compound-schema";

function parseArgs(argv) {
    const args = {
        schemaPath: defaultSchemaPath,
        entryId: defaultEntryId,
        dataPaths: []
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--schema") {
            args.schemaPath = path.resolve(cwd, argv[++i]);
        } else if (arg === "--entry-id") {
            args.entryId = argv[++i];
        } else if (arg === "--help" || arg === "-h") {
            args.help = true;
        } else {
            args.dataPaths.push(path.resolve(cwd, arg));
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

function decodePointerToken(token) {
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerTokens(pointer) {
    if (!pointer || pointer === "/") {
        return [];
    }
    return pointer
        .split("/")
        .slice(1)
        .map(decodePointerToken);
}

function pointerToFriendlyPath(pointer) {
    const tokens = pointerTokens(pointer);
    if (tokens.length === 0) {
        return "";
    }

    let out = "";
    for (const token of tokens) {
        if (/^\d+$/.test(token)) {
            out += `[${token}]`;
        } else if (out === "") {
            out = token;
        } else {
            out += `.${token}`;
        }
    }
    return out;
}

function appendFriendlyPath(basePointer, token) {
    const base = pointerToFriendlyPath(basePointer);
    if (/^\d+$/.test(token)) {
        return `${base}[${token}]`;
    }
    return base ? `${base}.${token}` : token;
}

function getValueAtPointer(data, pointer) {
    let current = data;
    for (const token of pointerTokens(pointer)) {
        if (current === undefined || current === null) {
            return undefined;
        }
        current = current[token];
    }
    return current;
}

function getActualType(value) {
    if (Array.isArray(value)) {
        return "array";
    }
    if (value === null) {
        return "null";
    }
    return typeof value;
}

function uniqueBySignature(items) {
    const seen = new Set();
    return items.filter((item) => {
        const signature = JSON.stringify(item);
        if (seen.has(signature)) {
            return false;
        }
        seen.add(signature);
        return true;
    });
}

function normalizeRawError(error) {
    return {
        keyword: error.keyword,
        instance_path: pointerToFriendlyPath(error.instancePath),
        schema_path: error.schemaPath,
        message: error.message,
        params: error.params
    };
}

function buildReport(dataFile, data, errors) {
    const compositePaths = new Set(
        errors
            .filter((error) => error.keyword === "oneOf" || error.keyword === "anyOf" || error.keyword === "allOf")
            .map((error) => error.instancePath)
    );

    const groupedEnumErrors = new Map();

    function isWithinCompositeBranchNoise(error) {
        for (const compositePath of compositePaths) {
            if (compositePath === "") {
                if (error.instancePath !== "") {
                    return true;
                }
                continue;
            }
            if (error.instancePath === compositePath || error.instancePath.startsWith(`${compositePath}/`)) {
                return true;
            }
        }
        return false;
    }

    const report = {
        file: path.relative(cwd, dataFile),
        valid: errors.length === 0,
        summary: {
            error_count: errors.length
        },
        missing_required: [],
        type_errors: [],
        enum_errors: [],
        unknown_fields: [],
        constraint_errors: [],
        composition_errors: [],
        consistency_checks: [],
        other_errors: [],
        raw_errors: errors.map(normalizeRawError)
    };

    for (const error of errors) {
        const isCompositeBranchNoise =
            isWithinCompositeBranchNoise(error) &&
            (error.keyword === "required" || error.keyword === "additionalProperties" || error.keyword === "enum");

        switch (error.keyword) {
            case "required": {
                if (isCompositeBranchNoise) {
                    break;
                }
                const missing = error.params.missingProperty;
                report.missing_required.push(appendFriendlyPath(error.instancePath, missing));
                break;
            }
            case "type": {
                const actualValue = getValueAtPointer(data, error.instancePath);
                report.type_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    expected: error.params.type,
                    actual: getActualType(actualValue),
                    message: error.message
                });
                break;
            }
            case "enum": {
                if (isCompositeBranchNoise) {
                    const key = error.instancePath;
                    const current = groupedEnumErrors.get(key) || {
                        path: pointerToFriendlyPath(error.instancePath),
                        expected_one_of: [],
                        actual: getValueAtPointer(data, error.instancePath),
                        message: "must be equal to one of the allowed values"
                    };
                    for (const value of error.params.allowedValues || []) {
                        if (!current.expected_one_of.includes(value)) {
                            current.expected_one_of.push(value);
                        }
                    }
                    groupedEnumErrors.set(key, current);
                    break;
                }
                report.enum_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    expected_one_of: error.params.allowedValues,
                    actual: getValueAtPointer(data, error.instancePath),
                    message: error.message
                });
                break;
            }
            case "const": {
                report.enum_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    expected_one_of: [error.params.allowedValue],
                    actual: getValueAtPointer(data, error.instancePath),
                    message: error.message
                });
                break;
            }
            case "additionalProperties": {
                if (isCompositeBranchNoise) {
                    break;
                }
                const property = error.params.additionalProperty;
                report.unknown_fields.push({
                    path: appendFriendlyPath(error.instancePath, property),
                    property,
                    message: error.message
                });
                break;
            }
            case "minimum":
            case "maximum":
            case "exclusiveMinimum":
            case "exclusiveMaximum":
            case "multipleOf":
            case "minLength":
            case "maxLength":
            case "pattern":
            case "format":
            case "minItems":
            case "maxItems":
            case "uniqueItems":
            case "contains":
            case "minContains":
            case "maxContains":
            case "minProperties":
            case "maxProperties":
            case "dependentRequired": {
                report.constraint_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    keyword: error.keyword,
                    params: error.params,
                    actual: getValueAtPointer(data, error.instancePath),
                    message: error.message
                });
                break;
            }
            case "oneOf":
            case "anyOf":
            case "allOf":
            case "not":
            case "if":
            case "then":
            case "else": {
                report.composition_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    keyword: error.keyword,
                    message: error.message,
                    params: error.params
                });
                break;
            }
            default: {
                report.other_errors.push({
                    path: pointerToFriendlyPath(error.instancePath),
                    keyword: error.keyword,
                    params: error.params,
                    actual: getValueAtPointer(data, error.instancePath),
                    message: error.message
                });
            }
        }
    }

    for (const grouped of groupedEnumErrors.values()) {
        grouped.expected_one_of.sort();
        report.enum_errors.push(grouped);
    }

    report.missing_required = [...new Set(report.missing_required)];
    report.type_errors = uniqueBySignature(report.type_errors);
    report.enum_errors = uniqueBySignature(report.enum_errors);
    report.unknown_fields = uniqueBySignature(report.unknown_fields);
    report.constraint_errors = uniqueBySignature(report.constraint_errors);
    report.composition_errors = uniqueBySignature(report.composition_errors);
    report.other_errors = uniqueBySignature(report.other_errors);

    report.summary = {
        error_count: report.raw_errors.length,
        missing_required: report.missing_required.length,
        type_errors: report.type_errors.length,
        enum_errors: report.enum_errors.length,
        unknown_fields: report.unknown_fields.length,
        constraint_errors: report.constraint_errors.length,
        composition_errors: report.composition_errors.length,
        other_errors: report.other_errors.length
    };

    return report;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.dataPaths.length === 0) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    let Ajv2020;
    try {
        ({ default: Ajv2020 } = await import("ajv/dist/2020.js"));
    } catch (error) {
        console.error("Could not load ajv. Run `npm install` in the repo root first.");
        process.exit(1);
    }

    const schema = JSON.parse(fs.readFileSync(args.schemaPath, "utf8"));
    const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        verbose: true,
        validateSchema: true
    });

    ajv.addSchema(schema);
    const validate = ajv.getSchema(args.entryId);

    if (!validate) {
        throw new Error(`Schema entrypoint not found: ${args.entryId}`);
    }

    const results = [];
    let hasFailures = false;

    for (const dataPath of args.dataPaths) {
        let data;
        try {
            data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
        } catch (error) {
            results.push({
                file: path.relative(cwd, dataPath),
                valid: false,
                parse_error: String(error),
                missing_required: [],
                type_errors: [],
                enum_errors: [],
                unknown_fields: [],
                constraint_errors: [],
                composition_errors: [],
                consistency_checks: [],
                other_errors: [],
                raw_errors: []
            });
            hasFailures = true;
            continue;
        }

        const ok = validate(data);
        const report = buildReport(dataPath, data, validate.errors || []);
        report.valid = ok;
        results.push(report);

        if (!ok) {
            hasFailures = true;
        }
    }

    const output = results.length === 1 ? results[0] : { results };
    console.log(JSON.stringify(output, null, 2));
    process.exit(hasFailures ? 1 : 0);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
