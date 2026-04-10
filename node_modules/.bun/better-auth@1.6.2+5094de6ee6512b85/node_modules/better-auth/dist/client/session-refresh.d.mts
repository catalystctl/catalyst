import { Session, User } from "../types/models.mjs";
import { AuthQueryAtom } from "./query.mjs";
import { BetterAuthClientOptions } from "@better-auth/core";
import { WritableAtom } from "nanostores";
import { BetterFetch } from "@better-fetch/fetch";

//#region src/client/session-refresh.d.ts
interface SessionRefreshOptions {
  sessionAtom: AuthQueryAtom<{
    user: User;
    session: Session;
  } & Record<string, any>>;
  sessionSignal: WritableAtom<boolean>;
  $fetch: BetterFetch;
  options?: BetterAuthClientOptions | undefined;
}
type SessionResponse = ({
  session: null;
  user: null;
  needsRefresh?: boolean;
} | {
  session: Session;
  user: User;
  needsRefresh?: boolean;
}) & Record<string, any>;
declare function createSessionRefreshManager(opts: SessionRefreshOptions): {
  init: () => void;
  cleanup: () => void;
  triggerRefetch: (event?: {
    event?: "poll" | "visibilitychange" | "storage";
  } | undefined) => void;
  broadcastSessionUpdate: (trigger: "signout" | "getSession" | "updateUser") => void;
};
//#endregion
export { SessionRefreshOptions, SessionResponse, createSessionRefreshManager };