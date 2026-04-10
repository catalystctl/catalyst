"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronFileParser = void 0;
const CronExpressionParser_1 = require("./CronExpressionParser");
/**
 * Parser for crontab files that handles both synchronous and asynchronous operations.
 */
class CronFileParser {
    /**
     * Parse a crontab file asynchronously
     * @param filePath Path to crontab file
     * @returns Promise resolving to parse results
     * @throws If file cannot be read
     */
    static async parseFile(filePath) {
        const { readFile } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
        const data = await readFile(filePath, 'utf8');
        return CronFileParser.#parseContent(data);
    }
    /**
     * Parse a crontab file synchronously
     * @param filePath Path to crontab file
     * @returns Parse results
     * @throws If file cannot be read
     */
    static parseFileSync(filePath) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readFileSync } = require('fs');
        const data = readFileSync(filePath, 'utf8');
        return CronFileParser.#parseContent(data);
    }
    /**
     * Internal method to parse crontab file content
     * @private
     */
    static #parseContent(data) {
        const blocks = data.split('\n');
        const result = {
            variables: {},
            expressions: [],
            errors: {},
        };
        for (const block of blocks) {
            const entry = block.trim();
            if (entry.length === 0 || entry.startsWith('#')) {
                continue;
            }
            const variableMatch = entry.match(/^(.*)=(.*)$/);
            if (variableMatch) {
                const [, key, value] = variableMatch;
                result.variables[key] = value.replace(/["']/g, ''); // Remove quotes
                continue;
            }
            try {
                const parsedEntry = CronFileParser.#parseEntry(entry);
                result.expressions.push(parsedEntry.interval);
            }
            catch (err) {
                result.errors[entry] = err;
            }
        }
        return result;
    }
    /**
     * Parse a single crontab entry
     * @private
     */
    static #parseEntry(entry) {
        const atoms = entry.split(' ');
        return {
            interval: CronExpressionParser_1.CronExpressionParser.parse(atoms.slice(0, 5).join(' ')),
            command: atoms.slice(5, atoms.length),
        };
    }
}
exports.CronFileParser = CronFileParser;
