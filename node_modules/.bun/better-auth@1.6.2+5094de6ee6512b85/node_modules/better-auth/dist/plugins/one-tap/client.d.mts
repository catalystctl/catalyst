import * as _better_auth_core0 from "@better-auth/core";
import { ClientFetchOption } from "@better-auth/core";
import * as _better_fetch_fetch0 from "@better-fetch/fetch";

//#region src/plugins/one-tap/client.d.ts
declare global {
  interface Window {
    googleScriptInitialized?: boolean | undefined;
  }
}
interface GsiButtonConfiguration {
  /**
   * The button type: icon, or standard button.
   */
  type: "standard" | "icon";
  /**
   * The button theme. For example, filled_blue or filled_black.
   * outline  A standard button theme:
   * filled_blue  A blue-filled button theme:
   * filled_black  A black-filled button theme:
   */
  theme?: "outline" | "filled_blue" | "filled_black";
  /**
   * The button size. For example, small or large.
   */
  size?: "small" | "medium" | "large";
  /**
   * The button text. The default value is signin_with.
   * There are no visual differences for the text of icon buttons that
   * have different text attributes. The only exception is when the
   * text is read for screen accessibility.
   *
   * signin_with  The button text is “Sign in with Google”:
   * signup_with  The button text is “Sign up with Google”:
   * continue_with  The button text is “Continue with Google”:
   * signup_with  The button text is “Sign in”:
   */
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  /**
   * The button shape. The default value is rectangular.
   */
  shape?: "rectangular" | "pill" | "circle" | "square";
  /**
   * The alignment of the Google logo. The default value is left.
   * This attribute only applies to the standard button type.
   */
  logo_alignment?: "left" | "center";
  /**
   * The minimum button width, in pixels. The maximum width is 400
   * pixels.
   */
  width?: number;
  /**
   * The pre-set locale of the button text. If it's not set, the
   * browser's default locale or the Google session user’s preference
   * is used.
   */
  locale?: string;
  /**
   * You can define a JavaScript function to be called when the
   * Sign in with Google button is clicked.
   */
  click_listener?: () => void;
  /**
   * Optional, as multiple Sign in with Google buttons can be
   * rendered on the same page, you can assign each button with a
   * unique string. The same string would return along with the ID
   * token, so you can identify which button user clicked to sign in.
   */
  state?: string;
}
interface GoogleOneTapOptions {
  /**
   * Google client ID
   */
  clientId: string;
  /**
   * Auto select the account if the user is already signed in
   */
  autoSelect?: boolean | undefined;
  /**
   * Cancel the flow when the user taps outside the prompt
   *
   * Note: To use this option, disable `promptOptions.fedCM`
   */
  cancelOnTapOutside?: boolean | undefined;
  /**
   * The mode to use for the Google One Tap flow
   *
   * popup: Use a popup window
   * redirect: Redirect the user to the Google One Tap flow
   *
   * @default "popup"
   */
  uxMode?: ("popup" | "redirect") | undefined;
  /**
   * The context to use for the Google One Tap flow.
   *
   * @see {@link https://developers.google.com/identity/gsi/web/reference/js-reference}
   * @default "signin"
   */
  context?: ("signin" | "signup" | "use") | undefined;
  /**
   * Additional configuration options to pass to the Google One Tap API.
   */
  additionalOptions?: Record<string, any> | undefined;
  /**
   * Configuration options for the prompt and exponential backoff behavior.
   */
  promptOptions?: {
    /**
     * Base delay (in milliseconds) for exponential backoff.
     * @default 1000
     */
    baseDelay?: number;
    /**
     * Maximum number of prompt attempts before calling onPromptNotification.
     * @default 5
     */
    maxAttempts?: number;
    /**
     * Whether to support FedCM (Federated Credential Management) support.
     *
     * @see {@link https://developer.chrome.com/docs/identity/fedcm/overview}
     * @default true
     */
    fedCM?: boolean | undefined;
  } | undefined;
}
interface GoogleOneTapActionOptions extends Omit<GoogleOneTapOptions, "clientId" | "promptOptions"> {
  fetchOptions?: ClientFetchOption | undefined;
  /**
   * Callback URL.
   */
  callbackURL?: string | undefined;
  /**
   * Optional callback that receives the prompt notification if (or when) the prompt is dismissed or skipped.
   * This lets you render an alternative UI (e.g. a Google Sign-In button) to restart the process.
   */
  onPromptNotification?: ((notification?: any | undefined) => void) | undefined;
  nonce?: string | undefined;
  /**
   * Button mode configuration. When provided, renders a "Sign In with Google" button
   * instead of showing the One Tap prompt.
   */
  button?: {
    /**
     * The HTML element or CSS selector where the button should be rendered.
     * If a string is provided, it will be used as a CSS selector.
     */
    container: HTMLElement | string;
    /**
     * Button configuration options
     */
    config?: GsiButtonConfiguration | undefined;
  } | undefined;
}
declare const oneTapClient: (options: GoogleOneTapOptions) => {
  id: "one-tap";
  version: string;
  fetchPlugins: {
    id: string;
    name: string;
    hooks: {
      onResponse(ctx: _better_fetch_fetch0.ResponseContext): Promise<void>;
    };
  }[];
  getActions: ($fetch: _better_fetch_fetch0.BetterFetch, _: _better_auth_core0.ClientStore) => {
    oneTap: (opts?: GoogleOneTapActionOptions | undefined, fetchOptions?: ClientFetchOption | undefined) => Promise<void>;
  };
  getAtoms($fetch: _better_fetch_fetch0.BetterFetch): {};
};
//#endregion
export { GoogleOneTapActionOptions, GoogleOneTapOptions, GsiButtonConfiguration, oneTapClient };