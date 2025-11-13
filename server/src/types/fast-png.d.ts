declare module 'fast-png' {
  export function encode(input: {
    width: number
    height: number
    data: Uint8Array
  }): Uint8Array
}
