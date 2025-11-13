export interface ComponentSummary {
  id: number
  cellCount: number
  centroidCol: number
  centroidRow: number
  meanSlopePercent: number
  bounds: { minRow: number; maxRow: number; minCol: number; maxCol: number }
}

export function findComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  slopePercent?: Float32Array,
): { summaries: ComponentSummary[]; labels: Int32Array } {
  const visited = new Uint8Array(mask.length)
  const labels = new Int32Array(mask.length)
  labels.fill(-1)
  const summaries: ComponentSummary[] = []
  const queueRow = new Int32Array(mask.length)
  const queueCol = new Int32Array(mask.length)

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const startIndex = row * width + col
      if (mask[startIndex] === 0 || visited[startIndex] === 1) {
        continue
      }

      let head = 0
      let tail = 0

      const enqueue = (r: number, c: number, idx: number) => {
        queueRow[tail] = r
        queueCol[tail] = c
        tail += 1
        visited[idx] = 1
        labels[idx] = summaries.length
      }

      enqueue(row, col, startIndex)

      let cellCount = 0
      let sumRow = 0
      let sumCol = 0
      let sumSlope = 0
      let slopeCount = 0
      let minRow = row
      let maxRow = row
      let minCol = col
      let maxCol = col

      while (head < tail) {
        const currentRow = queueRow[head]
        const currentCol = queueCol[head]
        head += 1

        const currentIndex = currentRow * width + currentCol
        cellCount += 1
        sumRow += currentRow
        sumCol += currentCol
        if (slopePercent) {
          const value = slopePercent[currentIndex]
          if (Number.isFinite(value)) {
            sumSlope += value
            slopeCount += 1
          }
        }

        if (currentRow < minRow) minRow = currentRow
        if (currentRow > maxRow) maxRow = currentRow
        if (currentCol < minCol) minCol = currentCol
        if (currentCol > maxCol) maxCol = currentCol

        for (const [dRow, dCol] of neighbours4) {
          const neighRow = currentRow + dRow
          const neighCol = currentCol + dCol

          if (
            neighRow < 0 ||
            neighRow >= height ||
            neighCol < 0 ||
            neighCol >= width
          ) {
            continue
          }
          const neighIndex = neighRow * width + neighCol
          if (mask[neighIndex] === 0 || visited[neighIndex] === 1) continue

          enqueue(neighRow, neighCol, neighIndex)
        }
      }

      const centroidRow = sumRow / cellCount
      const centroidCol = sumCol / cellCount
      const meanSlopePercent = slopeCount > 0 ? sumSlope / slopeCount : Number.NaN

      summaries.push({
        id: summaries.length,
        cellCount,
        centroidRow,
        centroidCol,
        meanSlopePercent,
        bounds: { minRow, maxRow, minCol, maxCol },
      })
    }
  }

  return { summaries, labels }
}

const neighbours4: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]
