//#region src/env/logger.d.ts
declare const TTY_COLORS: {
  readonly reset: "\u001B[0m";
  readonly bright: "\u001B[1m";
  readonly dim: "\u001B[2m";
  readonly undim: "\u001B[22m";
  readonly underscore: "\u001B[4m";
  readonly blink: "\u001B[5m";
  readonly reverse: "\u001B[7m";
  readonly hidden: "\u001B[8m";
  readonly fg: {
    readonly black: "\u001B[30m";
    readonly red: "\u001B[31m";
    readonly green: "\u001B[32m";
    readonly yellow: "\u001B[33m";
    readonly blue: "\u001B[34m";
    readonly magenta: "\u001B[35m";
    readonly cyan: "\u001B[36m";
    readonly white: "\u001B[37m";
  };
  readonly bg: {
    readonly black: "\u001B[40m";
    readonly red: "\u001B[41m";
    readonly green: "\u001B[42m";
    readonly yellow: "\u001B[43m";
    readonly blue: "\u001B[44m";
    readonly magenta: "\u001B[45m";
    readonly cyan: "\u001B[46m";
    readonly white: "\u001B[47m";
  };
};
type LogLevel = "debug" | "info" | "success" | "warn" | "error";
declare const levels: readonly ["debug", "info", "success", "warn", "error"];
declare function shouldPublishLog(currentLogLevel: LogLevel, logLevel: LogLevel): boolean;
interface Logger {
  disabled?: boolean | undefined;
  disableColors?: boolean | undefined;
  level?: Exclude<LogLevel, "success"> | undefined;
  log?: ((level: Exclude<LogLevel, "success">, message: string, ...args: any[]) => void) | undefined;
}
type LogHandlerParams = Parameters<NonNullable<Logger["log"]>> extends [LogLevel, ...infer Rest] ? Rest : never;
type InternalLogger = { [K in LogLevel]: (...params: LogHandlerParams) => void } & {
  get level(): LogLevel;
};
declare const createLogger: (options?: Logger | undefined) => InternalLogger;
declare const logger: InternalLogger;
//#endregion
export { InternalLogger, LogHandlerParams, LogLevel, Logger, TTY_COLORS, createLogger, levels, logger, shouldPublishLog };