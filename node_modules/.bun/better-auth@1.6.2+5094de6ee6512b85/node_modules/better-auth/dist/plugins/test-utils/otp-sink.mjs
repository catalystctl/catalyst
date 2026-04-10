//#region src/plugins/test-utils/otp-sink.ts
/**
* Creates an instance-scoped OTP store for capturing OTPs during testing.
* Each auth instance gets its own store to avoid cross-contamination.
*/
function createOTPStore() {
	const otpStore = /* @__PURE__ */ new Map();
	return {
		capture(identifier, otp) {
			otpStore.set(identifier, otp);
		},
		get(identifier) {
			return otpStore.get(identifier);
		},
		clear() {
			otpStore.clear();
		}
	};
}
//#endregion
export { createOTPStore };
