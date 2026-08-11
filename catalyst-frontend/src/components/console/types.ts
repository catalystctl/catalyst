/**
 * Console entry shapes shared by the hook and XtermConsole.
 * (ANSI/HTML processing types removed with CustomConsole.)
 */

export type RawEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};
