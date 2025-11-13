import FastPriorityQueue from 'fastpriorityqueue'

export interface PathfindingResult {
  cost: number
  cells: Array<{ row: number; col: number; index: number }>
}

interface NodeState {
  index: number
  cost: number
}

interface Options {
  width: number
  height: number
  costGrid: Float32Array
  traversableMask: Uint8Array
  maxCost?: number
}

const neighbours8: Array<{ dRow: number; dCol: number; moveCost: number }> = [
  { dRow: -1, dCol: 0, moveCost: 1 },
  { dRow: 1, dCol: 0, moveCost: 1 },
  { dRow: 0, dCol: -1, moveCost: 1 },
  { dRow: 0, dCol: 1, moveCost: 1 },
  { dRow: -1, dCol: -1, moveCost: Math.SQRT2 },
  { dRow: -1, dCol: 1, moveCost: Math.SQRT2 },
  { dRow: 1, dCol: -1, moveCost: Math.SQRT2 },
  { dRow: 1, dCol: 1, moveCost: Math.SQRT2 },
]

export function runAStar(
  start: { row: number; col: number; index: number },
  goal: { row: number; col: number; index: number },
  options: Options,
): PathfindingResult | null {
  const { width, height, costGrid, traversableMask } = options
  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY

  const openSet = new FastPriorityQueue<NodeState>((a, b) => a.cost < b.cost)
  const gScore = new Float32Array(width * height)
  gScore.fill(Number.POSITIVE_INFINITY)
  const cameFrom = new Int32Array(width * height)
  cameFrom.fill(-1)

  gScore[start.index] = 0
  openSet.add({ index: start.index, cost: heuristic(start.row, start.col, goal.row, goal.col) })

  while (!openSet.isEmpty()) {
    const current = openSet.poll()
    if (!current) break

    if (current.index === goal.index) {
      return reconstructPath(cameFrom, goal.index, width, gScore[goal.index])
    }

    const currentRow = Math.floor(current.index / width)
    const currentCol = current.index % width
    const currentG = gScore[current.index]

    for (const { dRow, dCol, moveCost } of neighbours8) {
      const neighRow = currentRow + dRow
      const neighCol = currentCol + dCol
      if (neighRow < 0 || neighRow >= height || neighCol < 0 || neighCol >= width) continue
      const neighIndex = neighRow * width + neighCol
      if (traversableMask[neighIndex] === 0) continue

      const traversalCost = costGrid[neighIndex] * moveCost
      if (!Number.isFinite(traversalCost)) continue

      const tentativeG = currentG + traversalCost
      if (tentativeG >= gScore[neighIndex] || tentativeG > maxCost) continue

      cameFrom[neighIndex] = current.index
      gScore[neighIndex] = tentativeG
      const fScore = tentativeG + heuristic(neighRow, neighCol, goal.row, goal.col)
      openSet.add({ index: neighIndex, cost: fScore })
    }
  }

  return null
}

function heuristic(rowA: number, colA: number, rowB: number, colB: number) {
  const dRow = rowB - rowA
  const dCol = colB - colA
  return Math.sqrt(dRow * dRow + dCol * dCol)
}

function reconstructPath(
  cameFrom: Int32Array,
  goalIndex: number,
  width: number,
  cost: number,
): PathfindingResult {
  const pathIndices: number[] = [goalIndex]
  let current = goalIndex
  while (cameFrom[current] !== -1) {
    current = cameFrom[current]
    pathIndices.push(current)
  }
  pathIndices.reverse()

  const cells = pathIndices.map((index) => ({
    index,
    row: Math.floor(index / width),
    col: index % width,
  }))

  return {
    cost,
    cells,
  }
}
