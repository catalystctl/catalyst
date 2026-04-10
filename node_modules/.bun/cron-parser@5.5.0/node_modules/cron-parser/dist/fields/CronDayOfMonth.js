"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronDayOfMonth = void 0;
const CronField_1 = require("./CronField");
const MIN_DAY = 1;
const MAX_DAY = 31;
const DAY_CHARS = Object.freeze(['L']);
/**
 * Represents the "day of the month" field within a cron expression.
 * @class CronDayOfMonth
 * @extends CronField
 */
class CronDayOfMonth extends CronField_1.CronField {
    static get min() {
        return MIN_DAY;
    }
    static get max() {
        return MAX_DAY;
    }
    static get chars() {
        return DAY_CHARS;
    }
    static get validChars() {
        return /^[?,*\dLH/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/;
    }
    /**
     * CronDayOfMonth constructor. Initializes the "day of the month" field with the provided values.
     * @param {DayOfMonthRange[]} values - Values for the "day of the month" field
     * @param {CronFieldOptions} [options] - Options provided by the parser
     * @throws {Error} if validation fails
     */
    constructor(values, options) {
        super(values, options);
        this.validate();
    }
    /**
     * Returns an array of allowed values for the "day of the month" field.
     * @returns {DayOfMonthRange[]}
     */
    get values() {
        return super.values;
    }
}
exports.CronDayOfMonth = CronDayOfMonth;
