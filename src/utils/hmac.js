/**
 * @fileoverview Client-side HMAC-SHA-256 verification for prediction payloads.
 *
 * The backend signs every prediction payload (Section 16.6.3).
 * The client verifies the signature before rendering any prediction.
 * This prevents tampered or injected prediction data from being displayed.
 *
 * NOTE: The HMAC key used here is a PUBLIC verification key only —
 * it is NOT the signing secret. The signing secret never leaves the backend.
 */

/**
 * Verifies a prediction payload against its HMAC-SHA-256 signature.
 *
 * @param {object} payload       - The prediction object (without hmacSignature field)
 * @param {string} signature     - Hex-encoded HMAC-SHA-256 from the backend
 * @param {string} verifyKey     - Public verification key (from VITE_ env)
 * @returns {Promise<boolean>}
 */
export async function verifyPredictionHmac(payload, signature, verifyKey) {
  try {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(verifyKey)
    const messageData = encoder.encode(JSON.stringify(payload))

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signatureBytes = hexToBytes(signature)

    return await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, messageData)
  } catch {
    // Any error in verification = treat as invalid
    return false
  }
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
