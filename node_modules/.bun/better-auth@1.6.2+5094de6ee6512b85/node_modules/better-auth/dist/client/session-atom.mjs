import { useAuthQuery } from "./query.mjs";
import { createSessionRefreshManager } from "./session-refresh.mjs";
import { atom, onMount } from "nanostores";
//#region src/client/session-atom.ts
function getSessionAtom($fetch, options) {
	const $signal = atom(false);
	const session = useAuthQuery($signal, "/get-session", $fetch, { method: "GET" });
	let broadcastSessionUpdate = () => {};
	onMount(session, () => {
		const refreshManager = createSessionRefreshManager({
			sessionAtom: session,
			sessionSignal: $signal,
			$fetch,
			options
		});
		refreshManager.init();
		broadcastSessionUpdate = refreshManager.broadcastSessionUpdate;
		return () => {
			refreshManager.cleanup();
		};
	});
	return {
		session,
		$sessionSignal: $signal,
		broadcastSessionUpdate: (trigger) => broadcastSessionUpdate(trigger)
	};
}
//#endregion
export { getSessionAtom };
