import type { RoadConfig } from '../../config/roads.js'

export function buildFrictionSurface(
  slopePercent: Float32Array,
  baseMask: Uint8Array,
  width: number,
  height: number,
  config: RoadConfig,
): Float32Array {
  const friction = new Float32Array(width * height)

  for (let i = 0; i < friction.length; i += 1) {
    if (baseMask[i] === 0) {
      friction[i] = Number.POSITIVE_INFINITY
      continue
    }

    const slope = slopePercent[i]
    if (!Number.isFinite(slope) || slope >= config.steepSlopeCutoffPercent) {
      friction[i] = Number.POSITIVE_INFINITY
      continue
    }

    const normalized = Math.max(0, slope / config.maxGradePercent)
    const penalty = 1 + Math.pow(normalized, config.slopePenaltyExponent)
    friction[i] = penalty
  }

  return friction
}
