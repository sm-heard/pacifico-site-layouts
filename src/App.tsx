import { useCallback, useMemo, useState } from 'react'
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from 'geojson'
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
  fetchConstraintsOverview,
  buildRoads,
  fetchTerrain,
  placeAssets,
  fetchRunManifest,
  type ConstraintsResponse,
  type ConstraintsOverviewResponse,
  type IngestResponse,
  type LayoutResponse,
  type RoadsResponse,
  type TerrainResponse,
  type RunManifestResponse,
  uploadSite,
} from './lib/api'
import { Switch } from './components/ui/switch'

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

interface PipelineParameters {
  maxSlopePercent: number
  propertySetbackMeters: number
  roadWidthMeters: number
  roadMaxGradePercent: number
}

const DEFAULT_PIPELINE_PARAMETERS: PipelineParameters = {
  maxSlopePercent: 6,
  propertySetbackMeters: 75,
  roadWidthMeters: 8,
  roadMaxGradePercent: 10,
}

function getStatusIcon(status: StageStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle2Icon className="h-4 w-4 text-accent drop-shadow-[0_0_6px_rgba(20,184,166,0.5)]" />
    case 'running':
      return <Loader2Icon className="h-4 w-4 animate-spin text-primary drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
    case 'error':
      return <TriangleAlertIcon className="h-4 w-4 text-destructive drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
    default:
      return <div className="h-2.5 w-2.5 rounded-full bg-muted border border-muted-foreground/20" />
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
  const [constraintsOverview, setConstraintsOverview] = useState<ConstraintsOverviewResponse | null>(null)
  const [showBaseMask, setShowBaseMask] = useState(true)
  const [showDistanceMask, setShowDistanceMask] = useState(false)
  const [showBoundary, setShowBoundary] = useState(false)
  const [showEntryPoints, setShowEntryPoints] = useState(false)
  const [runManifest, setRunManifest] = useState<RunManifestResponse | null>(null)
  const [pipelineParams, setPipelineParams] = useState<PipelineParameters>(DEFAULT_PIPELINE_PARAMETERS)
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787'

  const constraintParams = useMemo(() => ({
    maxSlopePercent: pipelineParams.maxSlopePercent,
    propertySetbackMeters: pipelineParams.propertySetbackMeters,
  }), [pipelineParams.maxSlopePercent, pipelineParams.propertySetbackMeters])

  const layoutParams = useMemo(() => ({
    maxSlopePercent: pipelineParams.maxSlopePercent,
  }), [pipelineParams.maxSlopePercent])

  const roadParams = useMemo(() => ({
    widthMeters: pipelineParams.roadWidthMeters,
    maxGradePercent: pipelineParams.roadMaxGradePercent,
  }), [pipelineParams.roadWidthMeters, pipelineParams.roadMaxGradePercent])

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

  const setStageRunningAndResetDownstream = useCallback((stage: PipelineTaskStage) => {
    setStageStatuses((prev) => {
      const next = { ...prev }
      const stageIndex = mapStageOrder.get(stage) ?? 0
      PIPELINE_STAGES.forEach((entry, index) => {
        if (index > stageIndex) {
          next[entry] = 'pending'
        }
      })
      next[stage] = 'running'
      return next
    })
  }, [])

  const markStageSuccess = useCallback((stage: PipelineTaskStage) => {
    setStageStatuses((prev) => ({ ...prev, [stage]: 'success' }))
  }, [])

  const markStageError = useCallback((stage: PipelineTaskStage) => {
    setStageStatuses((prev) => ({ ...prev, [stage]: 'error' }))
  }, [])

  const refreshManifest = useCallback(async (runId: string) => {
    try {
      const data = await fetchRunManifest(runId)
      setRunManifest(data.manifest)
    } catch (error) {
      console.warn('Failed to fetch run manifest', error)
    }
  }, [])

  const handleParameterInput = useCallback(
    (key: keyof PipelineParameters) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value)
      setPipelineParams((prev) => ({
        ...prev,
        [key]: Number.isFinite(value) ? value : prev[key],
      }))
    },
    [],
  )

  const resetParameters = useCallback(() => {
    setPipelineParams(DEFAULT_PIPELINE_PARAMETERS)
  }, [])

  const resetPipeline = useCallback(() => {
    setStageStatuses(createInitialStatuses())
    setResults({})
    setErrorMessage(null)
    setConstraintsOverview(null)
    setShowBaseMask(true)
    setShowDistanceMask(false)
    setShowBoundary(false)
    setShowEntryPoints(false)
    setRunManifest(null)
  }, [])

  const runPipeline = useCallback(async () => {
    if (!file) {
      toast.error('Upload a KML or KMZ file to continue')
      return
    }

    resetPipeline()
    setIsRunning(true)
    setConstraintsOverview(null)

    try {
      advanceStage('upload')
      const ingest = await uploadSite(file)
      completeStage('upload')
      await refreshManifest(ingest.runId)

      advanceStage('terrain')
      const terrain = await fetchTerrain(ingest.runId)
      completeStage('terrain')

      advanceStage('constraints')
      const constraints = await buildConstraints(ingest.runId, constraintParams)
      completeStage('constraints')

      try {
        const overview = await fetchConstraintsOverview(ingest.runId)
        setConstraintsOverview(overview)
      } catch (overviewError) {
        console.warn('Failed to fetch constraints overview', overviewError)
      }

      advanceStage('layout')
      const layout = await placeAssets(ingest.runId, layoutParams)
      completeStage('layout')

      advanceStage('roads')
      const roads = await buildRoads(ingest.runId, roadParams)
      completeStage('roads')

      setResults({ ingest, terrain, constraints, layout, roads })
      setRecenterToken((token) => token + 1)
      await refreshManifest(ingest.runId)
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
  }, [advanceStage, completeStage, constraintParams, file, layoutParams, refreshManifest, resetPipeline, roadParams])

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

  const baseMaskOverlay = useMemo(() => {
    if (!constraintsOverview || !showBaseMask) return undefined
    const [minLng, minLat, maxLng, maxLat] = constraintsOverview.grid.extentWgs84
    return {
      dataUrl: constraintsOverview.baseMaskDataUrl,
      bounds: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
    }
  }, [constraintsOverview, showBaseMask])

  const distanceMaskOverlay = useMemo(() => {
    if (!constraintsOverview || !showDistanceMask) return undefined
    const [minLng, minLat, maxLng, maxLat] = constraintsOverview.grid.extentWgs84
    return {
      dataUrl: constraintsOverview.distanceMaskDataUrl,
      bounds: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
    }
  }, [constraintsOverview, showDistanceMask])

  const boundaryFeature = useMemo<Feature<Polygon | MultiPolygon> | undefined>(() => {
    if (!constraintsOverview?.boundary || !showBoundary) return undefined
    return constraintsOverview.boundary as Feature<Polygon | MultiPolygon>
  }, [constraintsOverview?.boundary, showBoundary])

  const entryPointFeatures = useMemo<FeatureCollection<Point> | undefined>(() => {
    if (!constraintsOverview?.entryPoints || !showEntryPoints) return undefined
    return {
      type: 'FeatureCollection',
      features: constraintsOverview.entryPoints as Feature<Point>[],
    }
  }, [constraintsOverview?.entryPoints, showEntryPoints])

  const downloadItems = useMemo(() => {
    const runId = results.ingest?.runId
    if (!runId || !runManifest) return []

    const items: Array<{ label: string; path: string }> = []
    const push = (label: string, path?: string | null) => {
      if (path) items.push({ label, path })
    }

    push('Normalized site (GeoJSON)', runManifest.inputs?.normalizedGeoJsonPath)
    push('Base feasible area (PNG)', runManifest.constraints?.baseMaskPngPath)
    push('Distance to boundary (PNG)', runManifest.constraints?.distanceMaskPngPath)
    push('Placed assets (GeoJSON)', runManifest.layout?.assetsGeoJsonPath)
    push('Road centerlines (GeoJSON)', runManifest.roads?.centerlinesPath)
    push('Road corridors (GeoJSON)', runManifest.roads?.corridorsPath)
    push('Base mask (binary)', runManifest.constraints?.baseMaskPath)
    push('Distance to boundary (binary)', runManifest.constraints?.distanceMaskPath)

    return items.map((item) => ({
      label: item.label,
      url: buildDownloadUrl(apiBaseUrl, runId, item.path),
      filename: getFilename(item.path),
    }))
  }, [apiBaseUrl, runManifest, results.ingest?.runId])

  const manifestParameters = runManifest?.parameters as
    | {
        constraints?: { maxSlopePercent?: number; propertySetbackMeters?: number | null }
        roads?: { widthMeters?: number; maxGradePercent?: number | null }
      }
    | undefined

  const handleRerunTerrain = useCallback(async () => {
    const runId = results.ingest?.runId
    if (!runId) {
      toast.error('Run the full pipeline before rerunning terrain')
      return
    }
    setIsRunning(true)
    setStageRunningAndResetDownstream('terrain')
    setResults((prev) => ({ ...prev, terrain: undefined, constraints: undefined, layout: undefined, roads: undefined }))
    setConstraintsOverview(null)
    setShowBaseMask(true)
    setShowDistanceMask(false)
    setShowBoundary(false)
    setShowEntryPoints(false)
    try {
      const terrain = await fetchTerrain(runId)
      setResults((prev) => ({ ...prev, terrain }))
      markStageSuccess('terrain')
      await refreshManifest(runId)
      toast.success('Terrain regenerated')
    } catch (error) {
      console.error(error)
      markStageError('terrain')
      toast.error(error instanceof Error ? error.message : 'Failed to rebuild terrain')
    } finally {
      setIsRunning(false)
    }
  }, [markStageError, markStageSuccess, refreshManifest, results.ingest?.runId, setStageRunningAndResetDownstream])

  const handleRerunConstraints = useCallback(async () => {
    const runId = results.ingest?.runId
    if (!runId || !results.terrain) {
      toast.error('Generate terrain before rebuilding constraints')
      return
    }
    setIsRunning(true)
    setStageRunningAndResetDownstream('constraints')
    setResults((prev) => ({ ...prev, constraints: undefined, layout: undefined, roads: undefined }))
    setConstraintsOverview(null)
    setShowBaseMask(true)
    setShowDistanceMask(false)
    setShowBoundary(false)
    setShowEntryPoints(false)
    try {
      const constraints = await buildConstraints(runId, constraintParams)
      setResults((prev) => ({ ...prev, constraints, layout: undefined, roads: undefined }))
      try {
        const overview = await fetchConstraintsOverview(runId)
        setConstraintsOverview(overview)
      } catch (overviewError) {
        console.warn('Failed to fetch constraints overview', overviewError)
      }
      markStageSuccess('constraints')
      toast.success('Constraints rebuilt')
      await refreshManifest(runId)
    } catch (error) {
      console.error(error)
      markStageError('constraints')
      toast.error(error instanceof Error ? error.message : 'Failed to rebuild constraints')
    } finally {
      setIsRunning(false)
    }
  }, [constraintParams, markStageError, markStageSuccess, refreshManifest, results.ingest?.runId, results.terrain, setStageRunningAndResetDownstream])

  const handleRerunLayout = useCallback(async () => {
    const runId = results.ingest?.runId
    if (!runId || !results.constraints) {
      toast.error('Generate constraints before placing assets')
      return
    }
    setIsRunning(true)
    setStageRunningAndResetDownstream('layout')
    setResults((prev) => ({ ...prev, layout: undefined, roads: undefined }))
    try {
      const layout = await placeAssets(runId, layoutParams)
      setResults((prev) => ({ ...prev, layout, roads: undefined }))
      markStageSuccess('layout')
      setRecenterToken((token) => token + 1)
      await refreshManifest(runId)
      toast.success('Assets placed')
    } catch (error) {
      console.error(error)
      markStageError('layout')
      toast.error(error instanceof Error ? error.message : 'Failed to place assets')
    } finally {
      setIsRunning(false)
    }
  }, [layoutParams, markStageError, markStageSuccess, refreshManifest, results.constraints, results.ingest?.runId, setStageRunningAndResetDownstream])

  const handleRerunRoads = useCallback(async () => {
    const runId = results.ingest?.runId
    if (!runId || !results.layout) {
      toast.error('Place assets before routing roads')
      return
    }
    setIsRunning(true)
    setStageRunningAndResetDownstream('roads')
    setResults((prev) => ({ ...prev, roads: undefined }))
    try {
      const roads = await buildRoads(runId, roadParams)
      setResults((prev) => ({ ...prev, roads }))
      markStageSuccess('roads')
      setRecenterToken((token) => token + 1)
      await refreshManifest(runId)
      toast.success('Roads routed')
    } catch (error) {
      console.error(error)
      markStageError('roads')
      toast.error(error instanceof Error ? error.message : 'Failed to route roads')
    } finally {
      setIsRunning(false)
    }
  }, [markStageError, markStageSuccess, refreshManifest, results.ingest?.runId, results.layout, roadParams, setStageRunningAndResetDownstream])

  const renderStageAction = (stage: PipelineStage) => {
    const isStageRunning = stageStatuses[stage] === 'running'
    const disabledCommon = isRunning || isStageRunning

    switch (stage) {
      case 'upload':
        return <span className="text-xs text-muted-foreground">Upload new file</span>
      case 'terrain':
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRerunTerrain}
            disabled={disabledCommon || !results.ingest}
          >
            Re-run
          </Button>
        )
      case 'constraints':
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRerunConstraints}
            disabled={disabledCommon || !results.ingest || !results.terrain}
          >
            Re-run
          </Button>
        )
      case 'layout':
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRerunLayout}
            disabled={disabledCommon || !results.constraints}
          >
            Re-run
          </Button>
        )
      case 'roads':
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRerunRoads}
            disabled={disabledCommon || !results.layout}
          >
            Re-run
          </Button>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen relative">
      <header className="border-b border-border/50 bg-card/40 backdrop-blur-xl sticky top-0 z-50 coordinate-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-wide text-primary flex items-center gap-3">
              <span className="inline-block w-1 h-6 bg-accent"></span>
              PACIFICO SITE LAYOUTS
            </h1>
            <p className="text-xs text-muted-foreground mt-1 font-mono tracking-wider uppercase">
              Terrain Analysis • Asset Placement • Road Routing
            </p>
          </div>
          <Button variant="outline" className="border-accent/30 hover:border-accent/60 hover:bg-accent/10 transition-all" asChild>
            <a href="/parameters.md" target="_blank" rel="noopener noreferrer">
              <span className="font-mono text-xs">PARAMETERS</span>
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[380px,1fr] relative z-10">
        <div className="space-y-6">
          <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 hover:shadow-accent/10 transition-all duration-300 card-animate">
            <CardHeader className="border-b border-accent/10">
              <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                Data Upload
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Provide property boundary (KML/KMZ) • Entry points optional
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site-file" className="text-xs font-mono uppercase tracking-wide text-muted-foreground">KMZ / KML file</Label>
                <Input
                  id="site-file"
                  type="file"
                  accept=".kmz,.kml"
                  onChange={handleFileChange}
                  disabled={isRunning}
                  className="cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-accent/20 file:text-accent file:font-mono file:text-xs file:uppercase hover:file:bg-accent/30"
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
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold tracking-wider shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
                onClick={runPipeline}
                disabled={!file || isRunning}
              >
                {isRunning ? (
                  <>
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    <span className="font-mono text-sm">PROCESSING...</span>
                  </>
                ) : (
                  <>
                    <UploadIcon className="mr-2 h-4 w-4" />
                    <span className="font-mono text-sm">RUN PIPELINE</span>
                  </>
                )}
              </Button>

              <Separator className="my-4 bg-accent/20" />

              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold tracking-wide text-accent">Pipeline Parameters</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    Adjust constraints before execution
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetParameters} disabled={isRunning} className="hover:bg-accent/10 hover:text-accent font-mono text-xs">
                  RESET
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="param-max-slope" className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Max slope for assets (%)</Label>
                  <Input
                    id="param-max-slope"
                    type="number"
                    min={0}
                    step={0.5}
                    disabled={isRunning}
                    value={pipelineParams.maxSlopePercent}
                    onChange={handleParameterInput('maxSlopePercent')}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="param-setback" className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Property setback (m)</Label>
                  <Input
                    id="param-setback"
                    type="number"
                    min={0}
                    step={5}
                    disabled={isRunning}
                    value={pipelineParams.propertySetbackMeters}
                    onChange={handleParameterInput('propertySetbackMeters')}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="param-road-width" className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Road width (m)</Label>
                  <Input
                    id="param-road-width"
                    type="number"
                    min={1}
                    step={0.5}
                    disabled={isRunning}
                    value={pipelineParams.roadWidthMeters}
                    onChange={handleParameterInput('roadWidthMeters')}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="param-road-grade" className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Road max grade (%)</Label>
                  <Input
                    id="param-road-grade"
                    type="number"
                    min={0}
                    step={0.5}
                    disabled={isRunning}
                    value={pipelineParams.roadMaxGradePercent}
                    onChange={handleParameterInput('roadMaxGradePercent')}
                    className="tabular-nums"
                  />
                </div>
              </div>

              <div className="relative">
                <Progress value={stageProgress(stageStatuses)} className="h-3 bg-muted/50 overflow-hidden" />
                <div
                  className="absolute top-0 left-0 h-full elevation-gradient transition-all duration-500 ease-out"
                  style={{ width: `${stageProgress(stageStatuses)}%` }}
                />
              </div>

              {errorMessage ? (
                <div className="p-3 border border-destructive/30 bg-destructive/10 rounded-md">
                  <p className="text-xs font-mono text-destructive">{errorMessage}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 grid-scan card-animate">
            <CardHeader className="border-b border-accent/10">
              <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                Pipeline Status
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Sequential execution • Rerun individual stages
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
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
                      <TableCell>
                        {renderStageAction(stage)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {results.ingest ? (
            <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 card-animate">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                  Summary
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Key metrics • Latest run
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="border-l-2 border-primary/50 pl-3 py-1">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Run ID</p>
                  <p className="text-sm font-mono text-foreground mt-1">{results.ingest.runId}</p>
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
                  <SummaryItem
                    label="Asset slope limit"
                    value={`${formatNumber(manifestParameters?.constraints?.maxSlopePercent ?? pipelineParams.maxSlopePercent, 1)}%`}
                  />
                  <SummaryItem
                    label="Property setback"
                    value={`${formatNumber(manifestParameters?.constraints?.propertySetbackMeters ?? pipelineParams.propertySetbackMeters, 0)} m`}
                  />
                  <SummaryItem
                    label="Road width"
                    value={`${formatNumber(manifestParameters?.roads?.widthMeters ?? pipelineParams.roadWidthMeters, 1)} m`}
                  />
                  <SummaryItem
                    label="Road max grade"
                    value={`${formatNumber(manifestParameters?.roads?.maxGradePercent ?? pipelineParams.roadMaxGradePercent, 1)}%`}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {results.ingest && runManifest ? (
            <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 card-animate">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                  Exports
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Download artifacts • GeoJSON • PNG masks
                </CardDescription>
              </CardHeader>
              <CardContent>
                {downloadItems.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {downloadItems.map((item) => (
                      <Button key={item.label} variant="outline" size="sm" asChild>
                        <a href={item.url} download={item.filename} target="_blank" rel="noopener noreferrer">
                          {item.label}
                        </a>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Run the pipeline to generate exportable outputs.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="h-[520px] flex-1 card-contours border-accent/20 shadow-lg shadow-accent/5 card-animate">
            <CardHeader className="border-b border-accent/10">
              <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                Map Preview
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Geospatial visualization • Real-time updates
              </CardDescription>
            </CardHeader>
            <CardContent className="h-full">
              <div className="h-[360px] rounded-md border border-accent/20 overflow-hidden shadow-inner">
                <MapView
                  bbox={mapBbox}
                  assets={assetCollection}
                  roadCenterlines={roadCenterlines}
                  roadCorridors={roadCorridors}
                  focusPoint={mapFocusPoint}
                  baseMaskOverlay={baseMaskOverlay}
                  distanceMaskOverlay={distanceMaskOverlay}
                  boundary={boundaryFeature}
                  entryPoints={entryPointFeatures}
                  recenterToken={recenterToken}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <OverlayToggle
                    id="toggle-base-mask"
                    label="Base feasible area"
                    checked={showBaseMask}
                    onCheckedChange={(checked) => setShowBaseMask(checked)}
                    disabled={!constraintsOverview}
                  />
                  <OverlayToggle
                    id="toggle-distance-mask"
                    label="Distance to boundary"
                    checked={showDistanceMask}
                    onCheckedChange={(checked) => setShowDistanceMask(checked)}
                    disabled={!constraintsOverview}
                  />
                  <OverlayToggle
                    id="toggle-boundary"
                    label="Property boundary"
                    checked={showBoundary}
                    onCheckedChange={(checked) => setShowBoundary(checked)}
                    disabled={!constraintsOverview}
                  />
                  <OverlayToggle
                    id="toggle-entry"
                    label="Entry points"
                    checked={showEntryPoints}
                    onCheckedChange={(checked) => setShowEntryPoints(checked)}
                    disabled={!constraintsOverview}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setRecenterToken((token) => token + 1)}
                  disabled={!results.ingest}
                  className="border-accent/30 hover:border-accent/60 bg-secondary/80 hover:bg-accent/20 font-mono text-xs tracking-wider"
                >
                  GO TO SITE
                </Button>
              </div>
            </CardContent>
          </Card>

          {results.layout ? (
            <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 card-animate">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                  Placed Assets
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Slope analysis • Footprint metrics
                </CardDescription>
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
            <Card className="card-contours border-accent/20 shadow-lg shadow-accent/5 card-animate">
              <CardHeader className="border-b border-accent/10">
                <CardTitle className="text-accent flex items-center gap-2 text-sm uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                  Road Segments
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  A* pathfinding • Grade optimization
                </CardDescription>
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
    <div className="flex items-center justify-between text-sm border-l-2 border-accent/30 pl-3 py-1 hover:border-accent/60 transition-colors">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="font-mono font-semibold text-foreground">{value}</span>
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

function buildDownloadUrl(baseUrl: string, runId: string, relativePath: string) {
  const encodedSegments = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${baseUrl.replace(/\/$/, '')}/api/files/${encodeURIComponent(runId)}/${encodedSegments}`
}

function getFilename(relativePath: string) {
  const segments = relativePath.split('/')
  return segments[segments.length - 1] || relativePath
}

function OverlayToggle({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="legend-control" style={{ opacity: disabled ? 0.5 : 1 }}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <Label
        htmlFor={id}
        className="text-xs cursor-pointer"
      >
        {label}
      </Label>
    </div>
  )
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
