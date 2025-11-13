export interface SlopeAspectResult {
  slopeDegrees: Float32Array
  slopePercent: Float32Array
  aspectDegrees: Float32Array
}

export function computeSlopeAndAspect(
  elevations: Float32Array,
  width: number,
  height: number,
  cellSize: number,
): SlopeAspectResult {
  const slopeDegrees = new Float32Array(width * height)
  const slopePercent = new Float32Array(width * height)
  const aspectDegrees = new Float32Array(width * height)

  const scale = 1 / (8 * cellSize)

  const get = (row: number, col: number) => {
    const r = Math.min(Math.max(row, 0), height - 1)
    const c = Math.min(Math.max(col, 0), width - 1)
    return elevations[r * width + c]
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const z1 = get(row - 1, col - 1)
      const z2 = get(row - 1, col)
      const z3 = get(row - 1, col + 1)
      const z4 = get(row, col - 1)
      const z5 = get(row, col)
      const z6 = get(row, col + 1)
      const z7 = get(row + 1, col - 1)
      const z8 = get(row + 1, col)
      const z9 = get(row + 1, col + 1)

      if (!Number.isFinite(z1) || !Number.isFinite(z2) || !Number.isFinite(z3) || !Number.isFinite(z4) || !Number.isFinite(z5) || !Number.isFinite(z6) || !Number.isFinite(z7) || !Number.isFinite(z8) || !Number.isFinite(z9)) {
        const index = row * width + col
        slopeDegrees[index] = Number.NaN
        slopePercent[index] = Number.NaN
        aspectDegrees[index] = Number.NaN
        continue
      }

      const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) * scale
      const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) * scale
      const gradient = Math.sqrt(dzdx * dzdx + dzdy * dzdy)
      const slopeRad = Math.atan(gradient)
      const slopeDeg = (slopeRad * 180) / Math.PI

      let aspectRad = Math.atan2(dzdy, -dzdx)
      if (!Number.isFinite(aspectRad)) {
        aspectRad = 0
      }
      if (aspectRad < 0) {
        aspectRad += 2 * Math.PI
      }
      const aspectDeg = (aspectRad * 180) / Math.PI

      const index = row * width + col
      slopeDegrees[index] = slopeDeg
      slopePercent[index] = gradient * 100
      aspectDegrees[index] = aspectDeg
    }
  }

  return {
    slopeDegrees,
    slopePercent,
    aspectDegrees,
  }
}
