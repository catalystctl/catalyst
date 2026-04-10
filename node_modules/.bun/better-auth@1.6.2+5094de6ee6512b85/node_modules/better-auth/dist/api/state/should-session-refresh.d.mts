//#region src/api/state/should-session-refresh.d.ts
/**
 * State for skipping session refresh
 *
 * In some cases, such as when using server-side rendering (SSR) or when dealing with
 * certain types of requests, it may be necessary to skip session refresh to prevent
 * potential inconsistencies between the session data in the database and the session
 * data stored in cookies.
 */
declare const getShouldSkipSessionRefresh: () => Promise<boolean | null>, setShouldSkipSessionRefresh: (value: boolean | null) => Promise<void>;
//#endregion
export { getShouldSkipSessionRefresh, setShouldSkipSessionRefresh };