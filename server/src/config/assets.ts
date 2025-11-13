export interface AssetConstraintsProfile {
  id: AssetType
  label: string
  maxSlopePercent: number
  propertySetbackMeters: number
  footprint: {
    widthMeters: number
    heightMeters: number
  }
  spacingMeters: number
}

export type AssetType = 'substation' | 'operations' | 'laydown' | 'equipment'

export const ASSET_CONSTRAINTS: Record<AssetType, AssetConstraintsProfile> = {
  substation: {
    id: 'substation',
    label: 'Substation Pad',
    maxSlopePercent: 5,
    propertySetbackMeters: 100,
    footprint: { widthMeters: 120, heightMeters: 120 },
    spacingMeters: 150,
  },
  operations: {
    id: 'operations',
    label: 'O&M Building',
    maxSlopePercent: 5,
    propertySetbackMeters: 50,
    footprint: { widthMeters: 40, heightMeters: 20 },
    spacingMeters: 50,
  },
  laydown: {
    id: 'laydown',
    label: 'Laydown Yard',
    maxSlopePercent: 6,
    propertySetbackMeters: 75,
    footprint: { widthMeters: 80, heightMeters: 60 },
    spacingMeters: 50,
  },
  equipment: {
    id: 'equipment',
    label: 'Equipment Pad',
    maxSlopePercent: 6,
    propertySetbackMeters: 75,
    footprint: { widthMeters: 50, heightMeters: 50 },
    spacingMeters: 75,
  },
}

export const ASSET_TYPES = Object.keys(ASSET_CONSTRAINTS) as AssetType[]

export function minSlopePercentAcrossAssets() {
  return Math.min(...ASSET_TYPES.map((type) => ASSET_CONSTRAINTS[type].maxSlopePercent))
}

export function maxPropertySetback() {
  return Math.max(...ASSET_TYPES.map((type) => ASSET_CONSTRAINTS[type].propertySetbackMeters))
}
