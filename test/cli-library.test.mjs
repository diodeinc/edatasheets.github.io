import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
    getBundledSchema,
    validate
} from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const validExamplePath = path.join(repoRoot, "examples", "ic_microcontroller", "STM32F302R6T6TR.json");
const cliPath = path.join(repoRoot, "bin", "edatasheet.mjs");

test("library exposes the bundled schema", () => {
    const schema = getBundledSchema();
    assert.equal(schema.$id, "urn:edatasheets:component-compound-schema");
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("validate returns actionable validation errors for in-memory data", async () => {
    const result = await validate({
        componentID: {
            partType: "microcontroller"
        }
    });

    assert.equal(result.valid, false);
    assert.equal(result.file, "<memory>");
    assert.ok(result.missing_required.length > 0);
});

test("validate returns a valid report for a known-good example file", async () => {
    const report = await validate(validExamplePath);

    assert.equal(report.valid, true);
    assert.equal(report.summary.error_count, 0);
    assert.equal(report.file, path.relative(process.cwd(), validExamplePath));
});

test("CLI can print the bundled schema id", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "schema", "--id"], {
        cwd: repoRoot
    });

    assert.equal(stdout.trim(), "urn:edatasheets:component-compound-schema");
});

test("CLI validate exits successfully for a known-good example", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "validate", validExamplePath], {
        cwd: repoRoot
    });

    const report = JSON.parse(stdout);
    assert.equal(report.valid, true);
    assert.equal(report.summary.error_count, 0);
});
