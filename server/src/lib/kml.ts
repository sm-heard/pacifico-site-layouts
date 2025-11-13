import type { FeatureCollection } from 'geojson'
import { kml as parseKml } from '@tmcw/togeojson'
import JSZip from 'jszip'
import { DOMParser } from 'xmldom'
import { ensureFeatureCollection } from './geo/geojson.js'

const KML_MIME_TYPES = ['application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml']
const KMZ_MIME_TYPES = ['application/vnd.google-earth.kmz']

function parseKmlString(xml: string): FeatureCollection {
  const dom = new DOMParser().parseFromString(xml, 'text/xml')
  const geojson = parseKml(dom)
  return ensureFeatureCollection(geojson as FeatureCollection)
}

async function extractKmlFromKmz(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const kmlEntry = zip.file(/\.kml$/i)[0]
  if (!kmlEntry) {
    throw new Error('KMZ archive did not contain a KML file.')
  }
  return await kmlEntry.async('string')
}

export interface ParsedSpatialFile {
  featureCollection: FeatureCollection
  sourceName: string
  sourceType: 'kml' | 'kmz'
}

export async function parseSpatialUpload(
  buffer: Buffer,
  filename?: string,
  mimeType?: string,
): Promise<ParsedSpatialFile> {
  const normalizedName = filename?.toLowerCase() ?? 'upload'
  const ext = normalizedName.split('.').pop()

  const isKmz =
    ext === 'kmz' || (mimeType ? KMZ_MIME_TYPES.includes(mimeType) : false)
  const isKml =
    ext === 'kml' || (mimeType ? KML_MIME_TYPES.includes(mimeType) : false)

  let kmlString: string
  let sourceType: ParsedSpatialFile['sourceType']

  if (isKmz) {
    kmlString = await extractKmlFromKmz(buffer)
    sourceType = 'kmz'
  } else if (isKml) {
    kmlString = buffer.toString('utf-8')
    sourceType = 'kml'
  } else {
    throw new Error('Unsupported file type. Please upload a KML or KMZ file.')
  }

  const featureCollection = parseKmlString(kmlString)
  return {
    featureCollection,
    sourceName: filename ?? sourceType,
    sourceType,
  }
}
