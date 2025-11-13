declare module 'pngjs' {
  import { Buffer } from 'node:buffer'

  interface PNGOptions {
    width?: number
    height?: number
    fill?: boolean
    filterType?: number
  }

  export class PNG {
    width: number
    height: number
    data: Buffer
    constructor(options?: PNGOptions)
    parse(data: Buffer, callback: (error: Error | null, data: PNG) => void): PNG
    static sync: {
      read(data: Buffer, options?: PNGOptions): PNG
    }
  }
}
