import { useEffect, useMemo, useRef } from 'react'
import mapboxgl, { type Map, type Marker } from 'mapbox-gl'
import type { FeatureCollection, LineString, Polygon } from 'geojson'

const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

const ASSET_SOURCE_ID = 'assets-source'
const ASSET_LAYER_ID = 'assets-layer'
const ROAD_SOURCE_ID = 'roads-source'
const ROAD_LAYER_ID = 'roads-layer'
const CORRIDOR_SOURCE_ID = 'corridors-source'
const CORRIDOR_LAYER_ID = 'corridors-layer'

export interface MapViewProps {
  bbox?: [number, number, number, number]
  assets?: FeatureCollection<Polygon>
  roadCenterlines?: FeatureCollection<LineString>
  roadCorridors?: FeatureCollection<Polygon>
  focusPoint?: [number, number]
  recenterToken?: number
}

export function MapView({ bbox, assets, roadCenterlines, roadCorridors, focusPoint, recenterToken = 0 }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const markerRef = useRef<Marker | null>(null)

  const hasLayers = useMemo(
    () => Boolean(assets || roadCenterlines || roadCorridors),
    [assets, roadCenterlines, roadCorridors],
  )

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !mapboxToken) return

    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-98.5795, 39.8283],
      zoom: 4,
      attributionControl: true,
    })

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyLayers = () => {
      if (assets) {
        upsertGeoJsonSource(map, ASSET_SOURCE_ID, assets)
        upsertFillLayer(map, ASSET_LAYER_ID, ASSET_SOURCE_ID, {
          paint: {
            'fill-color': '#F97316',
            'fill-opacity': 0.35,
            'fill-outline-color': '#EA580C',
          },
        })
      } else if (map.getLayer(ASSET_LAYER_ID)) {
        map.removeLayer(ASSET_LAYER_ID)
        map.removeSource(ASSET_SOURCE_ID)
      }

      if (roadCorridors) {
        upsertGeoJsonSource(map, CORRIDOR_SOURCE_ID, roadCorridors)
        upsertFillLayer(map, CORRIDOR_LAYER_ID, CORRIDOR_SOURCE_ID, {
          paint: {
            'fill-color': '#22c55e',
            'fill-opacity': 0.25,
            'fill-outline-color': '#15803d',
          },
        })
      } else if (map.getLayer(CORRIDOR_LAYER_ID)) {
        map.removeLayer(CORRIDOR_LAYER_ID)
        map.removeSource(CORRIDOR_SOURCE_ID)
      }

      if (roadCenterlines) {
        upsertGeoJsonSource(map, ROAD_SOURCE_ID, roadCenterlines)
        upsertLineLayer(map, ROAD_LAYER_ID, ROAD_SOURCE_ID, {
          paint: {
            'line-color': '#16a34a',
            'line-width': 3,
          },
        })
      } else if (map.getLayer(ROAD_LAYER_ID)) {
        map.removeLayer(ROAD_LAYER_ID)
        map.removeSource(ROAD_SOURCE_ID)
      }
    }

    if (!map.isStyleLoaded()) {
      map.once('load', applyLayers)
      return
    }

    applyLayers()
  }, [assets, roadCenterlines, roadCorridors])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!focusPoint) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      return
    }

    const ensureMarker = () => {
      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker({ color: '#ef4444' }).setLngLat(focusPoint).addTo(map)
      } else {
        markerRef.current.setLngLat(focusPoint).addTo(map)
      }
    }

    const fly = () => {
      ensureMarker()
      map.flyTo({ center: focusPoint, zoom: Math.max(map.getZoom(), 14), speed: 0.9, curve: 1.4, essential: true })
    }

    if (!map.isStyleLoaded()) {
      map.once('load', fly)
      return
    }

    fly()
  }, [focusPoint])

  useEffect(() => {
    if (recenterToken === 0) return
    const map = mapRef.current
    if (!map) return

    const bounds = buildBounds({ assets, roadCorridors, bbox })
    if (!bounds) return

    const applyCamera = () => {
      const center = bounds.getCenter()
      map.jumpTo({ center, zoom: Math.max(map.getZoom(), 12) })
      map.fitBounds(bounds, { padding: 56, duration: 900, maxZoom: 16 })
    }

    if (!map.isStyleLoaded()) {
      map.once('load', applyCamera)
      return
    }

    if (map.areTilesLoaded()) {
      applyCamera()
    } else {
      map.once('idle', applyCamera)
    }
  }, [assets, roadCorridors, bbox, hasLayers, recenterToken])

  useEffect(() => {
    if (focusPoint) {
      console.debug('Map focus point', focusPoint)
    }
  }, [focusPoint])

  if (!mapboxToken) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border">
        <p className="text-sm text-muted-foreground">
          Set VITE_MAPBOX_TOKEN to visualize map overlays.
        </p>
      </div>
    )
  }

  return <div ref={mapContainerRef} className="h-full w-full rounded-md" />
}

function buildBounds({
  assets,
  roadCorridors,
  bbox,
}: {
  assets?: FeatureCollection<Polygon>
  roadCorridors?: FeatureCollection<Polygon>
  bbox?: [number, number, number, number]
}) {
  const coords: Array<[number, number]> = []

  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coords.push([value[0], value[1]])
        return
      }
      value.forEach(collect)
    }
  }

  if (roadCorridors) {
    roadCorridors.features.forEach((feature) => collect(feature.geometry.coordinates))
  }
  if (assets) {
    assets.features.forEach((feature) => collect(feature.geometry.coordinates))
  }
  if (bbox) {
    coords.push([bbox[0], bbox[1]], [bbox[2], bbox[3]])
  }

  if (coords.length === 0) return undefined

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  coords.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  })

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return undefined
  }

  return new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat])
}

function upsertGeoJsonSource(
  map: Map,
  sourceId: string,
  data: FeatureCollection,
) {
  const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
  } else {
    map.addSource(sourceId, {
      type: 'geojson',
      data,
    })
  }
}

function upsertFillLayer(
  map: Map,
  layerId: string,
  sourceId: string,
  options: mapboxgl.FillLayer,
) {
  if (map.getLayer(layerId)) return
  map.addLayer({
    id: layerId,
    type: 'fill',
    source: sourceId,
    paint: options.paint,
  })
}

function upsertLineLayer(
  map: Map,
  layerId: string,
  sourceId: string,
  options: mapboxgl.LineLayer,
) {
  if (map.getLayer(layerId)) return
  const layer: mapboxgl.LineLayer = {
    id: layerId,
    type: 'line',
    source: sourceId,
    paint: options.paint ?? { 'line-color': '#16a34a', 'line-width': 3 },
  }
  if (options.layout) {
    layer.layout = options.layout
  }
  map.addLayer(layer)
}
