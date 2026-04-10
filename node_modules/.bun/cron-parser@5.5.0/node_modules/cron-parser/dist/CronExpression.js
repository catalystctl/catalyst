"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CronExpression = exports.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE = exports.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE = void 0;
const CronDate_1 = require("./CronDate");
/**
 * Error message for when the current date is outside the specified time span.
 */
exports.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE = 'Out of the time span range';
/**
 * Error message for when the loop limit is exceeded during iteration.
 */
exports.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE = 'Invalid expression, loop limit exceeded';
/**
 * Cron iteration loop safety limit
 */
const LOOP_LIMIT = 10000;
/**
 * Class representing a Cron expression.
 */
class CronExpression {
    #options;
    #tz;
    #currentDate;
    #startDate;
    #endDate;
    #fields;
    #dstTransitionDayKey = null;
    #isDstTransitionDay = false;
    /**
     * Creates a new CronExpression instance.
     *
     * @param {CronFieldCollection} fields - Cron fields.
     * @param {CronExpressionOptions} options - Parser options.
     */
    constructor(fields, options) {
        this.#options = options;
        this.#tz = options.tz;
        this.#startDate = options.startDate ? new CronDate_1.CronDate(options.startDate, this.#tz) : null;
        this.#endDate = options.endDate ? new CronDate_1.CronDate(options.endDate, this.#tz) : null;
        let currentDateValue = options.currentDate ?? options.startDate;
        if (currentDateValue) {
            const tempCurrentDate = new CronDate_1.CronDate(currentDateValue, this.#tz);
            if (this.#startDate && tempCurrentDate.getTime() < this.#startDate.getTime()) {
                currentDateValue = this.#startDate;
            }
            else if (this.#endDate && tempCurrentDate.getTime() > this.#endDate.getTime()) {
                currentDateValue = this.#endDate;
            }
        }
        this.#currentDate = new CronDate_1.CronDate(currentDateValue, this.#tz);
        this.#fields = fields;
    }
    /**
     * Getter for the cron fields.
     *
     * @returns {CronFieldCollection} Cron fields.
     */
    get fields() {
        return this.#fields;
    }
    /**
     * Converts cron fields back to a CronExpression instance.
     *
     * @public
     * @param {Record<string, number[]>} fields - The input cron fields object.
     * @param {CronExpressionOptions} [options] - Optional parsing options.
     * @returns {CronExpression} - A new CronExpression instance.
     */
    static fieldsToExpression(fields, options) {
        return new CronExpression(fields, options || {});
    }
    /**
     * Checks if the given value matches any element in the sequence.
     *
     * @param {number} value - The value to be matched.
     * @param {number[]} sequence - The sequence to be checked against.
     * @returns {boolean} - True if the value matches an element in the sequence; otherwise, false.
     * @memberof CronExpression
     * @private
     */
    static #matchSchedule(value, sequence) {
        return sequence.some((element) => element === value);
    }
    /**
     * Returns the minimum or maximum value from the given array of numbers.
     *
     * @param {number[]} values - An array of numbers.
     * @param {boolean} reverse - If true, returns the maximum value; otherwise, returns the minimum value.
     * @returns {number} - The minimum or maximum value.
     */
    #getMinOrMax(values, reverse) {
        return values[reverse ? values.length - 1 : 0];
    }
    /**
     * Checks whether the given date falls on a DST transition day in its timezone.
     *
     * This is used to disable certain “direct set” fast paths on DST days, because setting the hour
     * directly may land on a non-existent or repeated local time. We cache the result per calendar day
     * to keep iteration overhead low.
     *
     * @param {CronDate} currentDate - Date to check (in the cron timezone)
     * @returns {boolean} True when the day has a DST transition
     * @private
     */
    #checkDstTransition(currentDate) {
        // Cache per calendar day (in the cron date's timezone) to avoid repeated work inside the iteration loop.
        const key = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
        if (this.#dstTransitionDayKey === key) {
            return this.#isDstTransitionDay;
        }
        const startOfDay = new CronDate_1.CronDate(currentDate);
        startOfDay.setStartOfDay();
        const endOfDay = new CronDate_1.CronDate(currentDate);
        endOfDay.setEndOfDay();
        this.#dstTransitionDayKey = key;
        this.#isDstTransitionDay = startOfDay.getUTCOffset() !== endOfDay.getUTCOffset();
        return this.#isDstTransitionDay;
    }
    /**
     * Moves the date to the next/previous allowed second value. If there is no remaining allowed second
     * within the current minute, rolls to the next/previous minute and resets seconds to the min/max allowed.
     *
     * @param {CronDate} currentDate - Mutable date being iterated
     * @param {DateMathOp} dateMathVerb - Add/Subtract depending on direction
     * @param {boolean} reverse - When true, iterating backwards
     * @private
     */
    #moveToNextSecond(currentDate, dateMathVerb, reverse) {
        const seconds = this.#fields.second.values;
        const currentSecond = currentDate.getSeconds();
        const nextSecond = this.#fields.second.findNearestValue(currentSecond, reverse);
        if (nextSecond !== null) {
            currentDate.setSeconds(nextSecond);
            return;
        }
        // Roll over to the next/previous minute and start from the min/max allowed second.
        currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Minute, this.#fields.hour.values.length);
        currentDate.setSeconds(this.#getMinOrMax(seconds, reverse));
    }
    /**
     * Moves the date to the next/previous allowed minute value and resets seconds to the min/max allowed.
     * If there is no remaining allowed minute within the current hour, rolls to the next/previous hour and
     * resets minutes/seconds to their extrema.
     *
     * @param {CronDate} currentDate - Mutable date being iterated
     * @param {DateMathOp} dateMathVerb - Add/Subtract depending on direction
     * @param {boolean} reverse - When true, iterating backwards
     * @private
     */
    #moveToNextMinute(currentDate, dateMathVerb, reverse) {
        const minutes = this.#fields.minute.values;
        const seconds = this.#fields.second.values;
        const currentMinute = currentDate.getMinutes();
        const nextMinute = this.#fields.minute.findNearestValue(currentMinute, reverse);
        if (nextMinute !== null) {
            currentDate.setMinutes(nextMinute);
            currentDate.setSeconds(this.#getMinOrMax(seconds, reverse));
            return;
        }
        // Roll over to the next/previous hour and start from the min/max allowed minute/second.
        currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Hour, this.#fields.hour.values.length);
        currentDate.setMinutes(this.#getMinOrMax(minutes, reverse));
        currentDate.setSeconds(this.#getMinOrMax(seconds, reverse));
    }
    /**
     * Determines if the current date matches the last specified weekday of the month.
     *
     * @param {Array<(number|string)>} expressions - An array of expressions containing weekdays and "L" for the last weekday.
     * @param {CronDate} currentDate - The current date object.
     * @returns {boolean} - True if the current date matches the last specified weekday of the month; otherwise, false.
     * @memberof CronExpression
     * @private
     */
    static #isLastWeekdayOfMonthMatch(expressions, currentDate) {
        const isLastWeekdayOfMonth = currentDate.isLastWeekdayOfMonth();
        return expressions.some((expression) => {
            // The first character represents the weekday
            const weekday = parseInt(expression.toString().charAt(0), 10) % 7;
            if (Number.isNaN(weekday)) {
                throw new Error(`Invalid last weekday of the month expression: ${expression}`);
            }
            // Check if the current date matches the last specified weekday of the month
            return currentDate.getDay() === weekday && isLastWeekdayOfMonth;
        });
    }
    /**
     * Find the next scheduled date based on the cron expression.
     * @returns {CronDate} - The next scheduled date or an ES6 compatible iterator object.
     * @memberof CronExpression
     * @public
     */
    next() {
        return this.#findSchedule();
    }
    /**
     * Find the previous scheduled date based on the cron expression.
     * @returns {CronDate} - The previous scheduled date or an ES6 compatible iterator object.
     * @memberof CronExpression
     * @public
     */
    prev() {
        return this.#findSchedule(true);
    }
    /**
     * Check if there is a next scheduled date based on the current date and cron expression.
     * @returns {boolean} - Returns true if there is a next scheduled date, false otherwise.
     * @memberof CronExpression
     * @public
     */
    hasNext() {
        const current = this.#currentDate;
        try {
            this.#findSchedule();
            return true;
        }
        catch {
            return false;
        }
        finally {
            this.#currentDate = current;
        }
    }
    /**
     * Check if there is a previous scheduled date based on the current date and cron expression.
     * @returns {boolean} - Returns true if there is a previous scheduled date, false otherwise.
     * @memberof CronExpression
     * @public
     */
    hasPrev() {
        const current = this.#currentDate;
        try {
            this.#findSchedule(true);
            return true;
        }
        catch {
            return false;
        }
        finally {
            this.#currentDate = current;
        }
    }
    /**
     * Iterate over a specified number of steps and optionally execute a callback function for each step.
     * @param {number} steps - The number of steps to iterate. Positive value iterates forward, negative value iterates backward.
     * @returns {CronDate[]} - An array of iterator fields or CronDate objects.
     * @memberof CronExpression
     * @public
     */
    take(limit) {
        const items = [];
        if (limit >= 0) {
            for (let i = 0; i < limit; i++) {
                try {
                    items.push(this.next());
                }
                catch {
                    return items;
                }
            }
        }
        else {
            for (let i = 0; i > limit; i--) {
                try {
                    items.push(this.prev());
                }
                catch {
                    return items;
                }
            }
        }
        return items;
    }
    /**
     * Reset the iterators current date to a new date or the initial date.
     * @param {Date | CronDate} [newDate] - Optional new date to reset to. If not provided, it will reset to the initial date.
     * @memberof CronExpression
     * @public
     */
    reset(newDate) {
        this.#currentDate = new CronDate_1.CronDate(newDate || this.#options.currentDate);
    }
    /**
     * Generate a string representation of the cron expression.
     * @param {boolean} [includeSeconds=false] - Whether to include the seconds field in the string representation.
     * @returns {string} - The string representation of the cron expression.
     * @memberof CronExpression
     * @public
     */
    stringify(includeSeconds = false) {
        return this.#fields.stringify(includeSeconds);
    }
    /**
     * Check if the cron expression includes the given date
     * @param {Date|CronDate} date
     * @returns {boolean}
     */
    includesDate(date) {
        const { second, minute, hour, month } = this.#fields;
        const dt = new CronDate_1.CronDate(date, this.#tz);
        // Check basic time fields first
        if (!second.values.includes(dt.getSeconds()) ||
            !minute.values.includes(dt.getMinutes()) ||
            !hour.values.includes(dt.getHours()) ||
            !month.values.includes((dt.getMonth() + 1))) {
            return false;
        }
        // Check day of month and day of week using the same logic as #findSchedule
        if (!this.#matchDayOfMonth(dt)) {
            return false;
        }
        // Check nth day of week if specified
        if (this.#fields.dayOfWeek.nthDay > 0) {
            const weekInMonth = Math.ceil(dt.getDate() / 7);
            if (weekInMonth !== this.#fields.dayOfWeek.nthDay) {
                return false;
            }
        }
        return true;
    }
    /**
     * Returns the string representation of the cron expression.
     * @returns {CronDate} - The next schedule date.
     */
    toString() {
        /* istanbul ignore next - should be impossible under normal use to trigger the or branch */
        return this.#options.expression || this.stringify(true);
    }
    /**
     * Determines if the given date matches the cron expression's day of month and day of week fields.
     *
     * The function checks the following rules:
     * Rule 1: If both "day of month" and "day of week" are restricted (not wildcard), then one or both must match the current day.
     * Rule 2: If "day of month" is restricted and "day of week" is not restricted, then "day of month" must match the current day.
     * Rule 3: If "day of month" is a wildcard, "day of week" is not a wildcard, and "day of week" matches the current day, then the match is accepted.
     * If none of the rules match, the match is rejected.
     *
     * @param {CronDate} currentDate - The current date to be evaluated against the cron expression.
     * @returns {boolean} Returns true if the current date matches the cron expression's day of month and day of week fields, otherwise false.
     * @memberof CronExpression
     * @private
     */
    #matchDayOfMonth(currentDate) {
        // Check if day of month and day of week fields are wildcards or restricted (not wildcard).
        const isDayOfMonthWildcardMatch = this.#fields.dayOfMonth.isWildcard;
        const isRestrictedDayOfMonth = !isDayOfMonthWildcardMatch;
        const isDayOfWeekWildcardMatch = this.#fields.dayOfWeek.isWildcard;
        const isRestrictedDayOfWeek = !isDayOfWeekWildcardMatch;
        // Calculate if the current date matches the day of month and day of week fields.
        const matchedDOM = CronExpression.#matchSchedule(currentDate.getDate(), this.#fields.dayOfMonth.values) ||
            (this.#fields.dayOfMonth.hasLastChar && currentDate.isLastDayOfMonth());
        const matchedDOW = CronExpression.#matchSchedule(currentDate.getDay(), this.#fields.dayOfWeek.values) ||
            (this.#fields.dayOfWeek.hasLastChar &&
                CronExpression.#isLastWeekdayOfMonthMatch(this.#fields.dayOfWeek.values, currentDate));
        // Rule 1: Both "day of month" and "day of week" are restricted; one or both must match the current day.
        if (isRestrictedDayOfMonth && isRestrictedDayOfWeek && (matchedDOM || matchedDOW)) {
            return true;
        }
        // Rule 2: "day of month" restricted and "day of week" not restricted; "day of month" must match the current day.
        if (matchedDOM && !isRestrictedDayOfWeek) {
            return true;
        }
        // Rule 3: "day of month" is a wildcard, "day of week" is not a wildcard, and "day of week" matches the current day.
        if (isDayOfMonthWildcardMatch && !isDayOfWeekWildcardMatch && matchedDOW) {
            return true;
        }
        // If none of the rules match, the match is rejected.
        return false;
    }
    /**
     * Determines if the current hour matches the cron expression.
     *
     * @param {CronDate} currentDate - The current date object.
     * @param {DateMathOp} dateMathVerb - The date math operation enumeration value.
     * @param {boolean} reverse - A flag indicating whether the matching should be done in reverse order.
     * @returns {boolean} - True if the current hour matches the cron expression; otherwise, false.
     */
    #matchHour(currentDate, dateMathVerb, reverse) {
        const hourValues = this.#fields.hour.values;
        const hours = hourValues;
        const currentHour = currentDate.getHours();
        const isMatch = CronExpression.#matchSchedule(currentHour, hourValues);
        const isDstStart = currentDate.dstStart === currentHour;
        const isDstEnd = currentDate.dstEnd === currentHour;
        // DST start: if the scheduled hour is skipped (e.g. 03:00 doesn't exist),
        // accept the next existing hour when it corresponds to the skipped one.
        if (isDstStart) {
            if (CronExpression.#matchSchedule(currentHour - 1, hourValues)) {
                return true;
            }
            currentDate.invokeDateOperation(dateMathVerb, CronDate_1.TimeUnit.Hour);
            return false;
        }
        // DST end: avoid returning the repeated hour twice when searching forward.
        if (isDstEnd && !reverse) {
            currentDate.dstEnd = null;
            currentDate.applyDateOperation(CronDate_1.DateMathOp.Add, CronDate_1.TimeUnit.Hour, hours.length);
            return false;
        }
        if (isMatch) {
            return true;
        }
        // Normal mismatch: if there's no remaining matching hour in this day, jump a whole day first
        // to avoid scanning hour-by-hour across the day boundary.
        currentDate.dstStart = null;
        const nextHour = this.#fields.hour.findNearestValue(currentHour, reverse);
        if (nextHour === null) {
            currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Day, hours.length);
            return false;
        }
        // Fast path: jump directly to the next/previous matching hour and reset lower units.
        //
        // On DST transition days, setting the hour directly can land on a non-existent/repeated local time,
        // which breaks the existing DST handling that relies on `applyDateOperation()` to set `dstStart/dstEnd`.
        // For those days, fall back to stepping hour-by-hour to preserve correctness.
        if (this.#checkDstTransition(currentDate)) {
            const steps = reverse ? currentHour - nextHour : nextHour - currentHour;
            for (let i = 0; i < steps; i++) {
                currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Hour, hours.length);
            }
        }
        else {
            currentDate.setHours(nextHour);
        }
        currentDate.setMinutes(this.#getMinOrMax(this.#fields.minute.values, reverse));
        currentDate.setSeconds(this.#getMinOrMax(this.#fields.second.values, reverse));
        return false;
    }
    /**
     * Validates the current date against the start and end dates of the cron expression.
     * If the current date is outside the specified time span, an error is thrown.
     *
     * @param currentDate {CronDate} - The current date to validate.
     * @throws {Error} If the current date is outside the specified time span.
     * @private
     */
    #validateTimeSpan(currentDate) {
        if (!this.#startDate && !this.#endDate) {
            return;
        }
        const currentTime = currentDate.getTime();
        if (this.#startDate && currentTime < this.#startDate.getTime()) {
            throw new Error(exports.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
        }
        if (this.#endDate && currentTime > this.#endDate.getTime()) {
            throw new Error(exports.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE);
        }
    }
    /**
     * Finds the next or previous schedule based on the cron expression.
     *
     * @param {boolean} [reverse=false] - If true, finds the previous schedule; otherwise, finds the next schedule.
     * @returns {CronDate} - The next or previous schedule date.
     * @private
     */
    #findSchedule(reverse = false) {
        const dateMathVerb = reverse ? CronDate_1.DateMathOp.Subtract : CronDate_1.DateMathOp.Add;
        const currentDate = new CronDate_1.CronDate(this.#currentDate);
        const startTimestamp = currentDate.getTime();
        let stepCount = 0;
        while (++stepCount < LOOP_LIMIT) {
            this.#validateTimeSpan(currentDate);
            if (!this.#matchDayOfMonth(currentDate)) {
                currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Day, this.#fields.hour.values.length);
                continue;
            }
            if (!(this.#fields.dayOfWeek.nthDay <= 0 || Math.ceil(currentDate.getDate() / 7) === this.#fields.dayOfWeek.nthDay)) {
                currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Day, this.#fields.hour.values.length);
                continue;
            }
            if (!CronExpression.#matchSchedule(currentDate.getMonth() + 1, this.#fields.month.values)) {
                currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Month, this.#fields.hour.values.length);
                continue;
            }
            if (!this.#matchHour(currentDate, dateMathVerb, reverse)) {
                continue;
            }
            if (!CronExpression.#matchSchedule(currentDate.getMinutes(), this.#fields.minute.values)) {
                this.#moveToNextMinute(currentDate, dateMathVerb, reverse);
                continue;
            }
            if (!CronExpression.#matchSchedule(currentDate.getSeconds(), this.#fields.second.values)) {
                this.#moveToNextSecond(currentDate, dateMathVerb, reverse);
                continue;
            }
            if (startTimestamp === currentDate.getTime()) {
                if (dateMathVerb === 'Add' || currentDate.getMilliseconds() === 0) {
                    currentDate.applyDateOperation(dateMathVerb, CronDate_1.TimeUnit.Second, this.#fields.hour.values.length);
                }
                continue;
            }
            break;
        }
        /* istanbul ignore next - should be impossible under normal use to trigger the branch */
        if (stepCount > LOOP_LIMIT) {
            throw new Error(exports.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE);
        }
        if (currentDate.getMilliseconds() !== 0) {
            currentDate.setMilliseconds(0);
        }
        this.#currentDate = currentDate;
        return currentDate;
    }
    /**
     * Returns an iterator for iterating through future CronDate instances
     *
     * @name Symbol.iterator
     * @memberof CronExpression
     * @returns {Iterator<CronDate>} An iterator object for CronExpression that returns CronDate values.
     */
    [Symbol.iterator]() {
        return {
            next: () => {
                const schedule = this.#findSchedule();
                return { value: schedule, done: !this.hasNext() };
            },
        };
    }
}
exports.CronExpression = CronExpression;
exports.default = CronExpression;
