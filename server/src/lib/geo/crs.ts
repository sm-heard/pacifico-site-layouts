import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson'
import { centroid } from '@turf/turf'
import * as utm from 'utm'

export interface LocalProjection {
  srid: string
  zoneNumber: number
  isNorthernHemisphere: boolean
  centroid: Feature<Point>
}

export function determineLocalProjection(
  featureOrCollection: Feature<Polygon | MultiPolygon> | FeatureCollection,
): LocalProjection {
  const centroidFeature = centroid(featureOrCollection as FeatureCollection)
  const [lon, lat] = centroidFeature.geometry.coordinates
  const utmPosition = utm.fromLatLon(lat, lon)

  const zoneNumber = utmPosition.zoneNum
  const isNorthernHemisphere = lat >= 0
  const epsgBase = isNorthernHemisphere ? 326 : 327
  const srid = `EPSG:${epsgBase + zoneNumber}`

  return {
    srid,
    zoneNumber,
    isNorthernHemisphere,
    centroid: centroidFeature,
  }
}

export function toLocalMeters(
  coordinate: [number, number],
  projection: LocalProjection,
): [number, number] {
  const [lon, lat] = coordinate
  const { easting, northing } = utm.fromLatLon(lat, lon, projection.zoneNumber)
  return [easting, northing]
}

export function fromLocalMeters(
  coordinate: [number, number],
  projection: LocalProjection,
): [number, number] {
  const [easting, northing] = coordinate
  const { latitude, longitude } = utm.toLatLon(
    easting,
    northing,
    projection.zoneNumber,
    projection.isNorthernHemisphere ? 'N' : 'S',
  )
  return [longitude, latitude]
}
