export interface RoadConfig {
  widthMeters: number
  maxGradePercent: number
  slopePenaltyExponent: number
  steepSlopeCutoffPercent: number
  diagonalCostMultiplier: number
}

export const DEFAULT_ROAD_CONFIG: RoadConfig = {
  widthMeters: 8,
  maxGradePercent: 10,
  slopePenaltyExponent: 2,
  steepSlopeCutoffPercent: 18,
  diagonalCostMultiplier: Math.SQRT2,
}
