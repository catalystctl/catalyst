import { getColorDepth } from "./color-depth.mjs";
//#region src/env/logger.ts
const TTY_COLORS = {
	reset: "\x1B[0m",
	bright: "\x1B[1m",
	dim: "\x1B[2m",
	undim: "\x1B[22m",
	underscore: "\x1B[4m",
	blink: "\x1B[5m",
	reverse: "\x1B[7m",
	hidden: "\x1B[8m",
	fg: {
		black: "\x1B[30m",
		red: "\x1B[31m",
		green: "\x1B[32m",
		yellow: "\x1B[33m",
		blue: "\x1B[34m",
		magenta: "\x1B[35m",
		cyan: "\x1B[36m",
		white: "\x1B[37m"
	},
	bg: {
		black: "\x1B[40m",
		red: "\x1B[41m",
		green: "\x1B[42m",
		yellow: "\x1B[43m",
		blue: "\x1B[44m",
		magenta: "\x1B[45m",
		cyan: "\x1B[46m",
		white: "\x1B[47m"
	}
};
const levels = [
	"debug",
	"info",
	"success",
	"warn",
	"error"
];
function shouldPublishLog(currentLogLevel, logLevel) {
	return levels.indexOf(logLevel) >= levels.indexOf(currentLogLevel);
}
const levelColors = {
	info: TTY_COLORS.fg.blue,
	success: TTY_COLORS.fg.green,
	warn: TTY_COLORS.fg.yellow,
	error: TTY_COLORS.fg.red,
	debug: TTY_COLORS.fg.magenta
};
const formatMessage = (level, message, colorsEnabled) => {
	const timestamp = (/* @__PURE__ */ new Date()).toISOString();
	if (colorsEnabled) return `${TTY_COLORS.dim}${timestamp}${TTY_COLORS.reset} ${levelColors[level]}${level.toUpperCase()}${TTY_COLORS.reset} ${TTY_COLORS.bright}[Better Auth]:${TTY_COLORS.reset} ${message}`;
	return `${timestamp} ${level.toUpperCase()} [Better Auth]: ${message}`;
};
const createLogger = (options) => {
	const enabled = options?.disabled !== true;
	const logLevel = options?.level ?? "warn";
	const colorsEnabled = options?.disableColors !== void 0 ? !options.disableColors : getColorDepth() !== 1;
	const LogFunc = (level, message, args = []) => {
		if (!enabled || !shouldPublishLog(logLevel, level)) return;
		const formattedMessage = formatMessage(level, message, colorsEnabled);
		if (!options || typeof options.log !== "function") {
			if (level === "error") console.error(formattedMessage, ...args);
			else if (level === "warn") console.warn(formattedMessage, ...args);
			else console.log(formattedMessage, ...args);
			return;
		}
		options.log(level === "success" ? "info" : level, message, ...args);
	};
	return {
		...Object.fromEntries(levels.map((level) => [level, (...[message, ...args]) => LogFunc(level, message, args)])),
		get level() {
			return logLevel;
		}
	};
};
const logger = createLogger();
//#endregion
export { TTY_COLORS, createLogger, levels, logger, shouldPublishLog };
