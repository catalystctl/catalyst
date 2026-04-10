"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronExpressionParser = exports.DayOfWeek = exports.Months = exports.CronUnit = exports.PredefinedExpressions = void 0;
const CronFieldCollection_1 = require("./CronFieldCollection");
const CronExpression_1 = require("./CronExpression");
const random_1 = require("./utils/random");
const fields_1 = require("./fields");
var PredefinedExpressions;
(function (PredefinedExpressions) {
    PredefinedExpressions["@yearly"] = "0 0 0 1 1 *";
    PredefinedExpressions["@annually"] = "0 0 0 1 1 *";
    PredefinedExpressions["@monthly"] = "0 0 0 1 * *";
    PredefinedExpressions["@weekly"] = "0 0 0 * * 0";
    PredefinedExpressions["@daily"] = "0 0 0 * * *";
    PredefinedExpressions["@hourly"] = "0 0 * * * *";
    PredefinedExpressions["@minutely"] = "0 * * * * *";
    PredefinedExpressions["@secondly"] = "* * * * * *";
    PredefinedExpressions["@weekdays"] = "0 0 0 * * 1-5";
    PredefinedExpressions["@weekends"] = "0 0 0 * * 0,6";
})(PredefinedExpressions || (exports.PredefinedExpressions = PredefinedExpressions = {}));
var CronUnit;
(function (CronUnit) {
    CronUnit["Second"] = "Second";
    CronUnit["Minute"] = "Minute";
    CronUnit["Hour"] = "Hour";
    CronUnit["DayOfMonth"] = "DayOfMonth";
    CronUnit["Month"] = "Month";
    CronUnit["DayOfWeek"] = "DayOfWeek";
})(CronUnit || (exports.CronUnit = CronUnit = {}));
// these need to be lowercase for the parser to work
var Months;
(function (Months) {
    Months[Months["jan"] = 1] = "jan";
    Months[Months["feb"] = 2] = "feb";
    Months[Months["mar"] = 3] = "mar";
    Months[Months["apr"] = 4] = "apr";
    Months[Months["may"] = 5] = "may";
    Months[Months["jun"] = 6] = "jun";
    Months[Months["jul"] = 7] = "jul";
    Months[Months["aug"] = 8] = "aug";
    Months[Months["sep"] = 9] = "sep";
    Months[Months["oct"] = 10] = "oct";
    Months[Months["nov"] = 11] = "nov";
    Months[Months["dec"] = 12] = "dec";
})(Months || (exports.Months = Months = {}));
// these need to be lowercase for the parser to work
var DayOfWeek;
(function (DayOfWeek) {
    DayOfWeek[DayOfWeek["sun"] = 0] = "sun";
    DayOfWeek[DayOfWeek["mon"] = 1] = "mon";
    DayOfWeek[DayOfWeek["tue"] = 2] = "tue";
    DayOfWeek[DayOfWeek["wed"] = 3] = "wed";
    DayOfWeek[DayOfWeek["thu"] = 4] = "thu";
    DayOfWeek[DayOfWeek["fri"] = 5] = "fri";
    DayOfWeek[DayOfWeek["sat"] = 6] = "sat";
})(DayOfWeek || (exports.DayOfWeek = DayOfWeek = {}));
/**
 * Static class that parses a cron expression and returns a CronExpression object.
 * @static
 * @class CronExpressionParser
 */
class CronExpressionParser {
    /**
     * Parses a cron expression and returns a CronExpression object.
     * @param {string} expression - The cron expression to parse.
     * @param {CronExpressionOptions} [options={}] - The options to use when parsing the expression.
     * @param {boolean} [options.strict=false] - If true, will throw an error if the expression contains both dayOfMonth and dayOfWeek.
     * @param {CronDate} [options.currentDate=new CronDate(undefined, 'UTC')] - The date to use when calculating the next/previous occurrence.
     *
     * @returns {CronExpression} A CronExpression object.
     */
    static parse(expression, options = {}) {
        const { strict = false, hashSeed } = options;
        const rand = (0, random_1.seededRandom)(hashSeed);
        expression = PredefinedExpressions[expression] || expression;
        const rawFields = CronExpressionParser.#getRawFields(expression, strict);
        if (!(rawFields.dayOfMonth === '*' || rawFields.dayOfWeek === '*' || !strict)) {
            throw new Error('Cannot use both dayOfMonth and dayOfWeek together in strict mode!');
        }
        const second = CronExpressionParser.#parseField(CronUnit.Second, rawFields.second, fields_1.CronSecond.constraints, rand);
        const minute = CronExpressionParser.#parseField(CronUnit.Minute, rawFields.minute, fields_1.CronMinute.constraints, rand);
        const hour = CronExpressionParser.#parseField(CronUnit.Hour, rawFields.hour, fields_1.CronHour.constraints, rand);
        const month = CronExpressionParser.#parseField(CronUnit.Month, rawFields.month, fields_1.CronMonth.constraints, rand);
        const dayOfMonth = CronExpressionParser.#parseField(CronUnit.DayOfMonth, rawFields.dayOfMonth, fields_1.CronDayOfMonth.constraints, rand);
        const { dayOfWeek: _dayOfWeek, nthDayOfWeek } = CronExpressionParser.#parseNthDay(rawFields.dayOfWeek);
        const dayOfWeek = CronExpressionParser.#parseField(CronUnit.DayOfWeek, _dayOfWeek, fields_1.CronDayOfWeek.constraints, rand);
        const fields = new CronFieldCollection_1.CronFieldCollection({
            second: new fields_1.CronSecond(second, { rawValue: rawFields.second }),
            minute: new fields_1.CronMinute(minute, { rawValue: rawFields.minute }),
            hour: new fields_1.CronHour(hour, { rawValue: rawFields.hour }),
            dayOfMonth: new fields_1.CronDayOfMonth(dayOfMonth, { rawValue: rawFields.dayOfMonth }),
            month: new fields_1.CronMonth(month, { rawValue: rawFields.month }),
            dayOfWeek: new fields_1.CronDayOfWeek(dayOfWeek, { rawValue: rawFields.dayOfWeek, nthDayOfWeek }),
        });
        return new CronExpression_1.CronExpression(fields, { ...options, expression });
    }
    /**
     * Get the raw fields from a cron expression.
     * @param {string} expression - The cron expression to parse.
     * @param {boolean} strict - If true, will throw an error if the expression contains both dayOfMonth and dayOfWeek.
     * @private
     * @returns {RawCronFields} The raw fields.
     */
    static #getRawFields(expression, strict) {
        if (strict && !expression.length) {
            throw new Error('Invalid cron expression');
        }
        expression = expression || '0 * * * * *';
        const atoms = expression.trim().split(/\s+/);
        if (strict && atoms.length < 6) {
            throw new Error('Invalid cron expression, expected 6 fields');
        }
        if (atoms.length > 6) {
            throw new Error('Invalid cron expression, too many fields');
        }
        const defaults = ['*', '*', '*', '*', '*', '0'];
        if (atoms.length < defaults.length) {
            atoms.unshift(...defaults.slice(atoms.length));
        }
        const [second, minute, hour, dayOfMonth, month, dayOfWeek] = atoms;
        return { second, minute, hour, dayOfMonth, month, dayOfWeek };
    }
    /**
     * Parse a field from a cron expression.
     * @param {CronUnit} field - The field to parse.
     * @param {string} value - The value of the field.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     * @returns {(number | string)[]} The parsed field.
     */
    static #parseField(field, value, constraints, rand) {
        // Replace aliases for month and dayOfWeek
        if (field === CronUnit.Month || field === CronUnit.DayOfWeek) {
            value = value.replace(/[a-z]{3}/gi, (match) => {
                match = match.toLowerCase();
                const replacer = Months[match] || DayOfWeek[match];
                if (replacer === undefined) {
                    throw new Error(`Validation error, cannot resolve alias "${match}"`);
                }
                return replacer.toString();
            });
        }
        // Check for valid characters
        if (!constraints.validChars.test(value)) {
            throw new Error(`Invalid characters, got value: ${value}`);
        }
        value = this.#parseWildcard(value, constraints);
        value = this.#parseHashed(value, constraints, rand);
        return this.#parseSequence(field, value, constraints);
    }
    /**
     * Parse a wildcard from a cron expression.
     * @param {string} value - The value to parse.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     */
    static #parseWildcard(value, constraints) {
        return value.replace(/[*?]/g, constraints.min + '-' + constraints.max);
    }
    /**
     * Parse a hashed value from a cron expression.
     * @param {string} value - The value to parse.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @param {PRNG} rand - The random number generator to use.
     * @private
     */
    static #parseHashed(value, constraints, rand) {
        const randomValue = rand();
        return value.replace(/H(?:\((\d+)-(\d+)\))?(?:\/(\d+))?/g, (_, min, max, step) => {
            // H(range)/step
            if (min && max && step) {
                const minNum = parseInt(min, 10);
                const maxNum = parseInt(max, 10);
                const stepNum = parseInt(step, 10);
                if (minNum > maxNum) {
                    throw new Error(`Invalid range: ${minNum}-${maxNum}, min > max`);
                }
                if (stepNum <= 0) {
                    throw new Error(`Invalid step: ${stepNum}, must be positive`);
                }
                const minStart = Math.max(minNum, constraints.min);
                const offset = Math.floor(randomValue * stepNum);
                const values = [];
                for (let i = Math.floor(minStart / stepNum) * stepNum + offset; i <= maxNum; i += stepNum) {
                    if (i >= minStart) {
                        values.push(i);
                    }
                }
                return values.join(',');
            }
            // H(range)
            else if (min && max) {
                const minNum = parseInt(min, 10);
                const maxNum = parseInt(max, 10);
                if (minNum > maxNum) {
                    throw new Error(`Invalid range: ${minNum}-${maxNum}, min > max`);
                }
                return String(Math.floor(randomValue * (maxNum - minNum + 1)) + minNum);
            }
            // H/step
            else if (step) {
                const stepNum = parseInt(step, 10);
                // Validate step
                if (stepNum <= 0) {
                    throw new Error(`Invalid step: ${stepNum}, must be positive`);
                }
                const offset = Math.floor(randomValue * stepNum);
                const values = [];
                for (let i = Math.floor(constraints.min / stepNum) * stepNum + offset; i <= constraints.max; i += stepNum) {
                    if (i >= constraints.min) {
                        values.push(i);
                    }
                }
                return values.join(',');
            }
            // H
            else {
                return String(Math.floor(randomValue * (constraints.max - constraints.min + 1) + constraints.min));
            }
        });
    }
    /**
     * Parse a sequence from a cron expression.
     * @param {CronUnit} field - The field to parse.
     * @param {string} val - The sequence to parse.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     */
    static #parseSequence(field, val, constraints) {
        const stack = [];
        function handleResult(result, constraints) {
            if (Array.isArray(result)) {
                stack.push(...result);
            }
            else {
                if (CronExpressionParser.#isValidConstraintChar(constraints, result)) {
                    stack.push(result);
                }
                else {
                    const v = parseInt(result.toString(), 10);
                    const isValid = v >= constraints.min && v <= constraints.max;
                    if (!isValid) {
                        throw new Error(`Constraint error, got value ${result} expected range ${constraints.min}-${constraints.max}`);
                    }
                    stack.push(field === CronUnit.DayOfWeek ? v % 7 : result);
                }
            }
        }
        const atoms = val.split(',');
        atoms.forEach((atom) => {
            if (!(atom.length > 0)) {
                throw new Error('Invalid list value format');
            }
            handleResult(CronExpressionParser.#parseRepeat(field, atom, constraints), constraints);
        });
        return stack;
    }
    /**
     * Parse repeat from a cron expression.
     * @param {CronUnit} field - The field to parse.
     * @param {string} val - The repeat to parse.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     * @returns {(number | string)[]} The parsed repeat.
     */
    static #parseRepeat(field, val, constraints) {
        const atoms = val.split('/');
        if (atoms.length > 2) {
            throw new Error(`Invalid repeat: ${val}`);
        }
        if (atoms.length === 2) {
            if (!isNaN(parseInt(atoms[0], 10))) {
                atoms[0] = `${atoms[0]}-${constraints.max}`;
            }
            return CronExpressionParser.#parseRange(field, atoms[0], parseInt(atoms[1], 10), constraints);
        }
        return CronExpressionParser.#parseRange(field, val, 1, constraints);
    }
    /**
     * Validate a cron range.
     * @param {number} min - The minimum value of the range.
     * @param {number} max - The maximum value of the range.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     * @returns {void}
     * @throws {Error} Throws an error if the range is invalid.
     */
    static #validateRange(min, max, constraints) {
        const isValid = !isNaN(min) && !isNaN(max) && min >= constraints.min && max <= constraints.max;
        if (!isValid) {
            throw new Error(`Constraint error, got range ${min}-${max} expected range ${constraints.min}-${constraints.max}`);
        }
        if (min > max) {
            throw new Error(`Invalid range: ${min}-${max}, min(${min}) > max(${max})`);
        }
    }
    /**
     * Validate a cron repeat interval.
     * @param {number} repeatInterval - The repeat interval to validate.
     * @private
     * @returns {void}
     * @throws {Error} Throws an error if the repeat interval is invalid.
     */
    static #validateRepeatInterval(repeatInterval) {
        if (!(!isNaN(repeatInterval) && repeatInterval > 0)) {
            throw new Error(`Constraint error, cannot repeat at every ${repeatInterval} time.`);
        }
    }
    /**
     * Create a range from a cron expression.
     * @param {CronUnit} field - The field to parse.
     * @param {number} min - The minimum value of the range.
     * @param {number} max - The maximum value of the range.
     * @param {number} repeatInterval - The repeat interval of the range.
     * @private
     * @returns {number[]} The created range.
     */
    static #createRange(field, min, max, repeatInterval) {
        const stack = [];
        if (field === CronUnit.DayOfWeek && max % 7 === 0) {
            stack.push(0);
        }
        for (let index = min; index <= max; index += repeatInterval) {
            if (stack.indexOf(index) === -1) {
                stack.push(index);
            }
        }
        return stack;
    }
    /**
     * Parse a range from a cron expression.
     * @param {CronUnit} field - The field to parse.
     * @param {string} val - The range to parse.
     * @param {number} repeatInterval - The repeat interval of the range.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @private
     * @returns {number[] | string[] | number | string} The parsed range.
     */
    static #parseRange(field, val, repeatInterval, constraints) {
        const atoms = val.split('-');
        if (atoms.length <= 1) {
            return isNaN(+val) ? val : +val;
        }
        const [min, max] = atoms.map((num) => parseInt(num, 10));
        this.#validateRange(min, max, constraints);
        this.#validateRepeatInterval(repeatInterval);
        // Create range
        return this.#createRange(field, min, max, repeatInterval);
    }
    /**
     * Parse a cron expression.
     * @param {string} val - The cron expression to parse.
     * @private
     * @returns {string} The parsed cron expression.
     */
    static #parseNthDay(val) {
        const atoms = val.split('#');
        if (atoms.length <= 1) {
            return { dayOfWeek: atoms[0] };
        }
        const nthValue = +atoms[atoms.length - 1];
        const matches = val.match(/([,-/])/);
        if (matches !== null) {
            throw new Error(`Constraint error, invalid dayOfWeek \`#\` and \`${matches?.[0]}\` special characters are incompatible`);
        }
        if (!(atoms.length <= 2 && !isNaN(nthValue) && nthValue >= 1 && nthValue <= 5)) {
            throw new Error('Constraint error, invalid dayOfWeek occurrence number (#)');
        }
        return { dayOfWeek: atoms[0], nthDayOfWeek: nthValue };
    }
    /**
     * Checks if a character is valid for a field.
     * @param {CronConstraints} constraints - The constraints for the field.
     * @param {string | number} value - The value to check.
     * @private
     * @returns {boolean} Whether the character is valid for the field.
     */
    static #isValidConstraintChar(constraints, value) {
        return constraints.chars.some((char) => value.toString().includes(char));
    }
}
exports.CronExpressionParser = CronExpressionParser;
