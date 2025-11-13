import { readFile, writeFile } from 'node:fs/promises'

export async function readFloat32Array(path: string, expectedLength: number): Promise<Float32Array> {
  const buffer = await readFile(path)
  if (buffer.byteLength % 4 !== 0) {
    throw new Error(`Invalid Float32 binary length for ${path}`)
  }
  const array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 4,
  )
  if (array.length !== expectedLength) {
    throw new Error(
      `Unexpected length for Float32 binary ${path}. Expected ${expectedLength}, got ${array.length}`,
    )
  }
  // Copy into a new Float32Array to detach from the underlying Buffer
  return new Float32Array(array)
}

export async function writeUint8Array(path: string, array: Uint8Array) {
  await writeFile(path, Buffer.from(array.buffer, array.byteOffset, array.byteLength))
}

export async function writeFloat32Array(path: string, array: Float32Array) {
  await writeFile(path, Buffer.from(array.buffer, array.byteOffset, array.byteLength))
}

export async function readUint8Array(path: string, expectedLength: number): Promise<Uint8Array> {
  const buffer = await readFile(path)
  if (buffer.byteLength !== expectedLength) {
    throw new Error(
      `Unexpected length for Uint8 binary ${path}. Expected ${expectedLength}, got ${buffer.byteLength}`,
    )
  }
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}
