import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Point,
  Polygon,
} from 'geojson'
import { area as turfArea } from '@turf/turf'

export interface NormalizedInputs {
  boundary: Feature<Polygon | MultiPolygon>
  entryPoints: Feature<Point>[]
  exclusions: Feature<Polygon | MultiPolygon>[]
  original: FeatureCollection
}

export function ensureFeatureCollection(input: FeatureCollection | Feature<Geometry>): FeatureCollection {
  if ('type' in input && input.type === 'FeatureCollection') {
    return input
  }

  return {
    type: 'FeatureCollection',
    features: [(input as Feature<Geometry>) ?? null].filter(Boolean) as Feature<Geometry>[],
  }
}

export function pickBoundaryPolygon(collection: FeatureCollection): Feature<Polygon | MultiPolygon> {
  const polygonFeatures = collection.features.filter((feature): feature is Feature<Polygon | MultiPolygon> =>
    feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
  )

  if (polygonFeatures.length === 0) {
    throw new Error('No polygon features were found in the uploaded file.')
  }

  const sorted = polygonFeatures
    .map((feature) => ({ feature, area: Math.abs(turfArea(feature)) }))
    .sort((a, b) => b.area - a.area)

  const boundary = sorted[0]?.feature
  if (!boundary) {
    throw new Error('Unable to identify a boundary polygon from the uploaded file.')
  }
  return boundary
}

export function collectEntryPoints(collection: FeatureCollection) {
  return collection.features.filter((feature): feature is Feature<Point> =>
    feature.geometry?.type === 'Point',
  )
}

export function collectExclusions(
  collection: FeatureCollection,
  boundary: Feature<Polygon | MultiPolygon>,
) {
  return collection.features.filter((feature): feature is Feature<Polygon | MultiPolygon> => {
    if (!feature.geometry) return false
    if (feature === boundary) return false
    return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
  })
}

export function normalizeInputs(collection: FeatureCollection): NormalizedInputs {
  const boundary = pickBoundaryPolygon(collection)
  const entryPoints = collectEntryPoints(collection)
  const exclusions = collectExclusions(collection, boundary)

  return {
    boundary,
    entryPoints,
    exclusions,
    original: collection,
  }
}
