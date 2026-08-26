# Native device authentication contract

Damasio OS keeps account passwords out of native storage. Device authentication is a local app lock around an already-authorized web session.

## Browser policy

- Mobile browsers do not expose biometric/passkey controls.
- Android/iOS native wrappers may expose device authentication through `window.FourSeasonsNative`.
- Desktop browsers may expose Supabase/WebAuthn passkeys only when `NEXT_PUBLIC_PASSKEYS_ENABLED=true` and the browser supports `PublicKeyCredential`.

## JavaScript bridge

The native wrapper should expose these methods on `window.FourSeasonsNative`:

- `getDeviceAuthPlatform(): "android" | "ios"`
- `isDeviceAuthAvailable(): boolean`
- `isDeviceAuthEnabled(): boolean`
- `requestEnableDeviceAuth(): void`
- `disableDeviceAuth(): void`
- `authenticateDevice(): void`

Async actions dispatch:

```js
window.dispatchEvent(new CustomEvent("fourSeasonsDeviceAuth", {
  detail: {
    action: "enable" | "disable" | "authenticate",
    success: true,
    enabled: true,
    reason: "ok"
  }
}))
```

No method may expose or accept an account password, Supabase access token, refresh token, Stripe secret, or service-role key.

## Android implementation

Android uses AndroidX `BiometricPrompt`. Android 11+ requests strong biometric or device credential. Older supported Android versions use the AndroidX device-credential fallback. The app hides the WebView until the prompt succeeds and re-locks after an extended background interval.

If device security is removed after device unlock was enabled, the native wrapper clears the local web session and requires normal account sign-in again.

## iOS implementation target

When the iOS wrapper is created, keep the same JavaScript contract and back it with `LocalAuthentication`:

- Evaluate `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication, ...)`.
- Authenticate with `.deviceOwnerAuthentication` so Face ID / Touch ID can fall back to the device passcode.
- Persist only the local `device_auth_enabled` preference in app-private storage/Keychain; never persist the account password.
- Keep the WKWebView hidden until authentication succeeds.
- On Face ID-capable builds, include the required Face ID usage description in the app plist.
- Clear the local web session and require account sign-in if device-owner authentication becomes unavailable.

Passkeys are a separate account authentication method. For a future native iOS passkey flow, prefer Supabase Swift passkey APIs / AuthenticationServices once the project-wide WebAuthn RP ID is finalized.
