import { fileURLToPath } from "node:url";

import { readBundledSchema, validateDocument, validateFiles } from "./validation.mjs";

export function getBundledSchema() {
    return JSON.parse(readBundledSchema());
}

export async function validate(input, options = {}) {
    if (typeof input === "string") {
        const result = await validateFiles({
            ...options,
            dataPaths: [input]
        });
        return result.results[0];
    }

    if (input instanceof URL) {
        if (input.protocol !== "file:") {
            throw new TypeError(`validate() only supports file: URLs, got ${input.protocol}`);
        }
        const result = await validateFiles({
            ...options,
            dataPaths: [fileURLToPath(input)]
        });
        return result.results[0];
    }

    if (input && typeof input === "object") {
        return validateDocument({
            ...options,
            data: input
        });
    }

    throw new TypeError("validate() expects a JavaScript object, file path string, or file: URL");
}
