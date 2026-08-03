import CryptoJS from 'crypto-js'

// Client-side AES-256 wrapper for identity/sensitive data that briefly
// exists in the browser before it's handed off to a Cloud Function (e.g. a
// reporter identity or burner email typed into an intake form draft, cached
// to sessionStorage so a refresh doesn't lose it). This is NOT where
// confidential-tier data ends up at rest - that's functions/src/utils/
// identityVault.js, encrypted server-side with its own key once the Cloud
// Function receives it. VITE_ANONYMOUS_SECRET mirrors the same
// build-time-injected-secret approach VoxWel uses for its equivalent field.
const secret = import.meta.env.VITE_ANONYMOUS_SECRET

function requireSecret() {
  if (!secret) {
    throw new Error(
      'VITE_ANONYMOUS_SECRET is not set - cannot encrypt or decrypt identity data'
    )
  }
  return secret
}

export function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encrypt() requires a non-empty string')
  }
  return CryptoJS.AES.encrypt(plaintext, requireSecret()).toString()
}

export function decrypt(ciphertext) {
  if (typeof ciphertext !== 'string' || !ciphertext) {
    throw new Error('decrypt() requires a non-empty string')
  }
  const bytes = CryptoJS.AES.decrypt(ciphertext, requireSecret())
  const plaintext = bytes.toString(CryptoJS.enc.Utf8)
  if (!plaintext) {
    throw new Error('Failed to decrypt - wrong secret or corrupted ciphertext')
  }
  return plaintext
}
