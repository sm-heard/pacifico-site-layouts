import { PNG } from 'pngjs'

export interface DecodedTerrainTile {
  width: number
  height: number
  elevations: Float32Array
}

export async function decodeTerrainTile(buffer: Buffer): Promise<DecodedTerrainTile> {
  const png = await decodePng(buffer)
  const { width, height, data } = png
  const elevations = new Float32Array(width * height)

  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const elevation = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
    elevations[i] = elevation
  }

  return { width, height, elevations }
}

function decodePng(buffer: Buffer): Promise<PNG> {
  return new Promise((resolve, reject) => {
    new PNG().parse(buffer, (error, data) => {
      if (error) {
        reject(error)
      } else {
        resolve(data)
      }
    })
  })
}
