/**
 * Clamps a probability value to the hard floor/ceiling defined in the spec
 * (Section 16.1.4 — Confidence Inflation Prevention).
 *
 * Raw model probabilities are NEVER shown to users.
 * This is the last safety gate before any number reaches the UI.
 *
 * @param {number} probability - Raw calibrated probability (0–100)
 * @param {number} [floor=5]
 * @param {number} [ceiling=99]
 * @returns {number}
 */
export function clampProbability(probability, floor = 5, ceiling = 99) {
  if (typeof probability !== 'number' || !isFinite(probability)) {
    return floor
  }
  return Math.min(ceiling, Math.max(floor, Math.round(probability)))
}

/**
 * Returns the complement label for a probability.
 * e.g. "78% means ~22% chance of being wrong" (Section 16.4.2 — Overconfidence bias)
 *
 * @param {number} probability - Already clamped probability
 * @returns {string}
 */
export function complementLabel(probability) {
  const complement = 100 - probability
  return `~${complement}% chance of being wrong`
}
