import { PACKAGE_VERSION } from "../../version.mjs";
//#region src/plugins/one-tap/client.ts
let isRequestInProgress = false;
function isFedCMSupported() {
	return typeof window !== "undefined" && "IdentityCredential" in window;
}
/**
* Reasons that should NOT trigger a retry.
* @see https://developers.google.com/identity/gsi/web/reference/js-reference
*/
const noRetryReasons = {
	dismissed: ["credential_returned", "cancel_called"],
	skipped: ["user_cancel", "tap_outside"]
};
const oneTapClient = (options) => {
	return {
		id: "one-tap",
		version: PACKAGE_VERSION,
		fetchPlugins: [{
			id: "fedcm-signout-handle",
			name: "FedCM Sign-Out Handler",
			hooks: { async onResponse(ctx) {
				if (!ctx.request.url.toString().includes("/sign-out")) return;
				if (options.promptOptions?.fedCM === false || !isFedCMSupported()) return;
				navigator.credentials.preventSilentAccess();
			} }
		}],
		getActions: ($fetch, _) => {
			return { oneTap: async (opts, fetchOptions) => {
				if (isRequestInProgress) {
					console.warn("A Google One Tap request is already in progress. Please wait.");
					return;
				}
				if (typeof window === "undefined" || !window.document) {
					console.warn("Google One Tap is only available in browser environments");
					return;
				}
				if (opts?.button) {
					await loadGoogleScript();
					const container = typeof opts.button.container === "string" ? document.querySelector(opts.button.container) : opts.button.container;
					if (!container) {
						console.error("Google One Tap: Button container not found", opts.button.container);
						return;
					}
					async function callback(idToken) {
						await $fetch("/one-tap/callback", {
							method: "POST",
							body: { idToken },
							...opts?.fetchOptions,
							...fetchOptions
						});
						if (!opts?.fetchOptions && !fetchOptions || opts?.callbackURL) window.location.href = opts?.callbackURL ?? "/";
					}
					const { autoSelect, cancelOnTapOutside, context } = opts ?? {};
					const contextValue = context ?? options.context ?? "signin";
					const useFedCM = options.promptOptions?.fedCM !== false;
					window.google?.accounts.id.initialize({
						client_id: options.clientId,
						callback: async (response) => {
							try {
								await callback(response.credential);
							} catch (error) {
								console.error("Error during button callback:", error);
							}
						},
						auto_select: autoSelect,
						cancel_on_tap_outside: cancelOnTapOutside,
						context: contextValue,
						ux_mode: opts?.uxMode || "popup",
						nonce: opts?.nonce,
						itp_support: true,
						use_fedcm_for_prompt: useFedCM,
						...options.additionalOptions
					});
					window.google?.accounts.id.renderButton(container, opts.button.config ?? { type: "icon" });
					return;
				}
				async function callback(idToken) {
					await $fetch("/one-tap/callback", {
						method: "POST",
						body: { idToken },
						...opts?.fetchOptions,
						...fetchOptions
					});
					if (!opts?.fetchOptions && !fetchOptions || opts?.callbackURL) window.location.href = opts?.callbackURL ?? "/";
				}
				const { autoSelect, cancelOnTapOutside, context } = opts ?? {};
				const contextValue = context ?? options.context ?? "signin";
				isRequestInProgress = true;
				try {
					await loadGoogleScript();
					await new Promise((resolve, reject) => {
						let isResolved = false;
						const baseDelay = options.promptOptions?.baseDelay ?? 1e3;
						const maxAttempts = options.promptOptions?.maxAttempts ?? 5;
						const useFedCM = options.promptOptions?.fedCM !== false;
						window.google?.accounts.id.initialize({
							client_id: options.clientId,
							callback: async (response) => {
								isResolved = true;
								try {
									await callback(response.credential);
									resolve();
								} catch (error) {
									console.error("Error during One Tap callback:", error);
									reject(error);
								}
							},
							auto_select: autoSelect,
							cancel_on_tap_outside: cancelOnTapOutside,
							context: contextValue,
							ux_mode: opts?.uxMode || "popup",
							nonce: opts?.nonce,
							itp_support: true,
							use_fedcm_for_prompt: useFedCM,
							...options.additionalOptions
						});
						const handlePrompt = (attempt) => {
							if (isResolved) return;
							window.google?.accounts.id.prompt((notification) => {
								if (isResolved) return;
								if (notification.isDismissedMoment?.()) {
									const reason = notification.getDismissedReason?.();
									if (noRetryReasons.dismissed.includes(reason)) {
										opts?.onPromptNotification?.(notification);
										resolve();
										return;
									}
									if (attempt < maxAttempts) {
										const delay = Math.pow(2, attempt) * baseDelay;
										setTimeout(() => handlePrompt(attempt + 1), delay);
									} else {
										opts?.onPromptNotification?.(notification);
										resolve();
									}
								} else if (notification.isSkippedMoment?.()) {
									const reason = notification.getSkippedReason?.();
									if (!reason || noRetryReasons.skipped.includes(reason)) {
										opts?.onPromptNotification?.(notification);
										resolve();
										return;
									}
									if (attempt < maxAttempts) {
										const delay = Math.pow(2, attempt) * baseDelay;
										setTimeout(() => handlePrompt(attempt + 1), delay);
									} else {
										opts?.onPromptNotification?.(notification);
										resolve();
									}
								} else if (notification.isNotDisplayed?.()) {
									opts?.onPromptNotification?.(notification);
									resolve();
								}
							});
						};
						handlePrompt(0);
					});
				} catch (error) {
					console.error("Error during Google One Tap flow:", error);
					throw error;
				} finally {
					isRequestInProgress = false;
				}
			} };
		},
		getAtoms($fetch) {
			return {};
		}
	};
};
const loadGoogleScript = () => {
	return new Promise((resolve, reject) => {
		if (window.googleScriptInitialized) {
			resolve();
			return;
		}
		const script = document.createElement("script");
		script.src = "https://accounts.google.com/gsi/client";
		script.async = true;
		script.defer = true;
		script.onload = () => {
			window.googleScriptInitialized = true;
			resolve();
		};
		script.onerror = () => {
			reject(/* @__PURE__ */ new Error("Failed to load Google Identity Services script"));
		};
		document.head.appendChild(script);
	});
};
//#endregion
export { oneTapClient };
