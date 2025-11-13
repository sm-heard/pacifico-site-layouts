import { useCallback, useMemo, useState } from 'react'
import type { FeatureCollection, LineString, Polygon } from 'geojson'
import { UploadIcon, CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import { MapView } from './components/map-view'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Progress } from './components/ui/progress'
import { Separator } from './components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table'
import {
  buildConstraints,
  buildRoads,
  fetchTerrain,
  placeAssets,
  type ConstraintsResponse,
  type IngestResponse,
  type LayoutResponse,
  type RoadsResponse,
  type TerrainResponse,
  uploadSite,
} from './lib/api'

const PIPELINE_STAGES = ['upload', 'terrain', 'constraints', 'layout', 'roads'] as const
type PipelineTaskStage = (typeof PIPELINE_STAGES)[number]

type StageStatus = 'pending' | 'running' | 'success' | 'error'

const stageLabels: Record<PipelineTaskStage, string> = {
  upload: 'Upload & Normalize',
  terrain: 'Terrain & Slope',
  constraints: 'Constraint Masks',
  layout: 'Asset Placement',
  roads: 'Road Routing',
}

const mapStageOrder = new Map<PipelineTaskStage, number>(
  PIPELINE_STAGES.map((stage, index) => [stage, index]),
)

const createInitialStatuses = (): Record<PipelineTaskStage, StageStatus> =>
  PIPELINE_STAGES.reduce(
    (acc, stage) => ({ ...acc, [stage]: 'pending' as StageStatus }),
    {} as Record<PipelineTaskStage, StageStatus>,
  )

interface PipelineData {
  ingest?: IngestResponse
  terrain?: TerrainResponse
  constraints?: ConstraintsResponse
  layout?: LayoutResponse
  roads?: RoadsResponse
}

function getStatusIcon(status: StageStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
    case 'running':
      return <Loader2Icon className="h-4 w-4 animate-spin text-primary" />
    case 'error':
      return <TriangleAlertIcon className="h-4 w-4 text-destructive" />
    default:
      return <div className="h-2.5 w-2.5 rounded-full bg-muted" />
  }
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [stageStatuses, setStageStatuses] = useState<Record<PipelineTaskStage, StageStatus>>(
    () => createInitialStatuses(),
  )
  const [results, setResults] = useState<PipelineData>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [recenterToken, setRecenterToken] = useState(0)

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
  }, [])

  const advanceStage = useCallback((stage: PipelineTaskStage) => {
    setStageStatuses((prev) => {
      const next: Record<PipelineTaskStage, StageStatus> = { ...prev }
      const currentIndex = mapStageOrder.get(stage) ?? 0
      PIPELINE_STAGES.forEach((entry, index) => {
        if (index < currentIndex) {
          next[entry] = 'success'
        } else if (index === currentIndex) {
          next[entry] = 'running'
        } else if (next[entry] === 'running') {
          next[entry] = 'pending'
        }
      })
      return next
    })
  }, [])

  const completeStage = useCallback((stage: PipelineTaskStage) => {
    setStageStatuses((prev) => ({ ...prev, [stage]: 'success' }))
  }, [])

  const resetPipeline = useCallback(() => {
    setStageStatuses(createInitialStatuses())
    setResults({})
    setErrorMessage(null)
  }, [])

  const runPipeline = useCallback(async () => {
    if (!file) {
      toast.error('Upload a KML or KMZ file to continue')
      return
    }

    resetPipeline()
    setIsRunning(true)

    try {
      advanceStage('upload')
      const ingest = await uploadSite(file)
      completeStage('upload')

      advanceStage('terrain')
      const terrain = await fetchTerrain(ingest.runId)
      completeStage('terrain')

      advanceStage('constraints')
      const constraints = await buildConstraints(ingest.runId)
      completeStage('constraints')

      advanceStage('layout')
      const layout = await placeAssets(ingest.runId)
      completeStage('layout')

      advanceStage('roads')
      const roads = await buildRoads(ingest.runId)
      completeStage('roads')

      setResults({ ingest, terrain, constraints, layout, roads })
      setRecenterToken((token) => token + 1)
      toast.success('Pipeline completed')
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'Unexpected error'
      setErrorMessage(message)
      toast.error(message)
      setStageStatuses((prev) => {
        const next = { ...prev }
        const runningStage = PIPELINE_STAGES.find((stage) => prev[stage] === 'running')
        if (runningStage) {
          next[runningStage] = 'error'
        }
        return next
      })
    } finally {
      setIsRunning(false)
    }
  }, [advanceStage, completeStage, file, resetPipeline])

  const assetCollection = useMemo<FeatureCollection<Polygon> | undefined>(() => {
    if (!results.layout?.features) return undefined
    return {
      type: 'FeatureCollection',
      features: results.layout.features as FeatureCollection<Polygon>['features'],
    }
  }, [results.layout?.features])

  const roadCenterlines = useMemo<FeatureCollection<LineString> | undefined>(() => {
    if (!results.roads?.segments) return undefined
    return {
      type: 'FeatureCollection',
      features: results.roads.segments.map((segment) => segment.line) as FeatureCollection<LineString>['features'],
    }
  }, [results.roads?.segments])

  const roadCorridors = useMemo<FeatureCollection<Polygon> | undefined>(() => {
    if (!results.roads?.segments) return undefined
    return {
      type: 'FeatureCollection',
      features: results.roads.segments.map((segment) => segment.corridor) as FeatureCollection<Polygon>['features'],
    }
  }, [results.roads?.segments])

  const mapBbox = useMemo(() => {
    const corridorBbox = roadCorridors ? featureCollectionBbox(roadCorridors) : undefined
    if (corridorBbox) return corridorBbox

    const assetBbox = assetCollection ? featureCollectionBbox(assetCollection) : undefined
    if (assetBbox) return assetBbox

    return results.ingest?.boundaryBbox
  }, [roadCorridors, assetCollection, results.ingest?.boundaryBbox])

  const mapFocusPoint = useMemo<[number, number] | undefined>(() => {
    if (results.layout?.placedAssets?.length) {
      return results.layout.placedAssets[0].center.wgs84
    }
    if (mapBbox) {
      const [minLng, minLat, maxLng, maxLat] = mapBbox
      return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    }
    return undefined
  }, [results.layout?.placedAssets, mapBbox])

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background/50 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold">Pacifico Site Layouts</h1>
            <p className="text-sm text-muted-foreground">
              Upload a KML/KMZ to generate terrain, constraints, layouts, and road corridors.
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="/parameters.md" target="_blank" rel="noopener noreferrer">
              View Default Parameters
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[360px,1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data Upload</CardTitle>
              <CardDescription>
                Provide a property boundary (KML/KMZ). Entry points and exclusions are optional.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site-file">KMZ / KML file</Label>
                <Input
                  id="site-file"
                  type="file"
                  accept=".kmz,.kml"
                  onChange={handleFileChange}
                  disabled={isRunning}
                />
                {file ? (
                  <p className="text-xs text-muted-foreground">Selected: {file.name}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Max size 50&nbsp;MB. The ingest step stores the normalized GeoJSON for reuse.
                  </p>
                )}
              </div>

              <Button
                className="w-full"
                onClick={runPipeline}
                disabled={!file || isRunning}
              >
                {isRunning ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> Running pipeline…
                  </>
                ) : (
                  <>
                    <UploadIcon className="mr-2 h-4 w-4" /> Run full pipeline
                  </>
                )}
              </Button>

              <Progress value={stageProgress(stageStatuses)} className="h-2" />

              {errorMessage ? (
                <p className="text-sm font-medium text-destructive">{errorMessage}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline Status</CardTitle>
              <CardDescription>Each stage runs sequentially; rerun after adjusting inputs.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PIPELINE_STAGES.map((stage) => (
                    <TableRow key={stage}>
                      <TableCell>{stageLabels[stage]}</TableCell>
                      <TableCell className="flex items-center gap-2">
                        {getStatusIcon(stageStatuses[stage])}
                        <span className="text-sm capitalize">{stageStatuses[stage]}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {results.ingest ? (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>Key metrics from the latest run.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="font-medium">Run ID</p>
                  <p className="text-muted-foreground">{results.ingest.runId}</p>
                </div>
                <Separator />
                <div className="grid gap-3">
                  <SummaryItem
                    label="Boundary area"
                    value={`${formatNumber(results.ingest.boundaryAreaSqMeters / 1_000_000, 2)} km²`}
                  />
                  {results.terrain ? (
                    <SummaryItem
                      label="Slope (mean)"
                      value={`${formatNumber(results.terrain.slope.meanDegrees, 1)}°`}
                    />
                  ) : null}
                  {results.constraints ? (
                    <SummaryItem
                      label="Feasible cells"
                      value={formatNumber(results.constraints.baseFeasibleCells)}
                    />
                  ) : null}
                  {results.roads ? (
                    <SummaryItem
                      label="Road length"
                      value={`${formatNumber(results.roads.totalLengthMeters / 1000, 2)} km`}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="h-[420px] flex-1">
            <CardHeader>
              <CardTitle>Map Preview</CardTitle>
              <CardDescription>Assets and road corridors appear after their respective stages.</CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div className="h-[320px] rounded-md border">
                <MapView
                  bbox={mapBbox}
                  assets={assetCollection}
                  roadCenterlines={roadCenterlines}
                  roadCorridors={roadCorridors}
                  focusPoint={mapFocusPoint}
                  recenterToken={recenterToken}
                />
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setRecenterToken((token) => token + 1)}
                  disabled={!results.ingest}
                >
                  Go to site
                </Button>
              </div>
            </CardContent>
          </Card>

          {results.layout ? (
            <Card>
              <CardHeader>
                <CardTitle>Placed Assets</CardTitle>
                <CardDescription>Mean slope evaluated within each pad footprint.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Mean slope</TableHead>
                      <TableHead>Center (lon, lat)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.layout.placedAssets.map((asset) => (
                      <TableRow key={`${asset.assetType}-${asset.center.row}-${asset.center.col}`}>
                        <TableCell className="font-medium capitalize">{asset.assetType}</TableCell>
                        <TableCell>{formatNumber(asset.slopeMeanPercent, 2)}%</TableCell>
                        <TableCell>
                          {formatNumber(asset.center.wgs84[0], 6)}, {formatNumber(asset.center.wgs84[1], 6)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          {results.roads ? (
            <Card>
              <CardHeader>
                <CardTitle>Road Segments</CardTitle>
                <CardDescription>Segments are routed from the entry point to each placed asset.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Length (m)</TableHead>
                      <TableHead>Max grade</TableHead>
                      <TableHead>Mean grade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.roads.segments.map((segment, index) => (
                      <TableRow key={`${segment.assetType}-${index}`}>
                        <TableCell className="capitalize">{segment.assetType}</TableCell>
                        <TableCell>{formatNumber(segment.lengthMeters, 1)}</TableCell>
                        <TableCell>{formatNumber(segment.maxGradePercent, 2)}%</TableCell>
                        <TableCell>{formatNumber(segment.meanGradePercent, 2)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function stageProgress(statuses: Record<PipelineTaskStage, StageStatus>) {
  const total = PIPELINE_STAGES.length
  const completed = PIPELINE_STAGES.filter((stage) => statuses[stage] === 'success').length
  const running = PIPELINE_STAGES.some((stage) => statuses[stage] === 'running')
  const base = (completed / total) * 100
  const value = running ? base + 10 : base
  return Math.min(100, value)
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function formatNumber(value: number, decimals = 0) {
  if (!Number.isFinite(value)) return '–'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function featureCollectionBbox<T extends Polygon | LineString>(collection: FeatureCollection<T>) {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0] as number
      const lat = coords[1] as number
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
      return
    }
    (coords as unknown[]).forEach((value) => visit(value))
  }

  collection.features.forEach((feature) => {
    visit(feature.geometry.coordinates)
  })

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return undefined
  }

  return [minLng, minLat, maxLng, maxLat] as [number, number, number, number]
}
