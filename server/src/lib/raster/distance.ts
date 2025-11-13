export interface DistanceTransformResult {
  distances: Float32Array
  maxDistance: number
}

export function computeDistanceFromBoundary(
  mask: Uint8Array,
  width: number,
  height: number,
  resolutionMeters: number,
): DistanceTransformResult {
  const total = width * height
  const distancesCells = new Int32Array(total)
  distancesCells.fill(-1)

  const queue = new Uint32Array(total)
  let head = 0
  let tail = 0

  const push = (index: number) => {
    queue[tail] = index
    tail += 1
  }

  const pop = () => {
    const value = queue[head]
    head += 1
    return value
  }

  const enqueueBoundaryCell = (index: number) => {
    distancesCells[index] = 0
    push(index)
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col
      if (mask[index] === 0) continue

      if (isBoundaryCell(mask, width, height, row, col)) {
        enqueueBoundaryCell(index)
      }
    }
  }

  const neighbourOffsets = [-width, width, -1, 1]

  while (head < tail) {
    const index = pop()
    const currentDistance = distancesCells[index]
    const row = Math.floor(index / width)
    const col = index % width

    for (const offset of neighbourOffsets) {
      let neighbourIndex: number | null = null
      switch (offset) {
        case -width:
          neighbourIndex = row > 0 ? index - width : null
          break
        case width:
          neighbourIndex = row < height - 1 ? index + width : null
          break
        case -1:
          neighbourIndex = col > 0 ? index - 1 : null
          break
        case 1:
          neighbourIndex = col < width - 1 ? index + 1 : null
          break
      }

      if (neighbourIndex == null) continue
      if (mask[neighbourIndex] === 0) continue
      if (distancesCells[neighbourIndex] !== -1) continue

      distancesCells[neighbourIndex] = currentDistance + 1
      push(neighbourIndex)
    }
  }

  let maxDistance = 0
  const distancesMeters = new Float32Array(total)
  for (let i = 0; i < total; i += 1) {
    const value = distancesCells[i]
    if (value < 0) {
      distancesMeters[i] = 0
    } else {
      const distance = value * resolutionMeters
      distancesMeters[i] = distance
      if (distance > maxDistance) maxDistance = distance
    }
  }

  return { distances: distancesMeters, maxDistance }
}

function isBoundaryCell(mask: Uint8Array, width: number, height: number, row: number, col: number) {
  const index = row * width + col
  if (mask[index] === 0) return false

  if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
    return true
  }

  const neighbours = [
    mask[index - width],
    mask[index + width],
    mask[index - 1],
    mask[index + 1],
  ]

  return neighbours.some((value) => value === 0)
}
