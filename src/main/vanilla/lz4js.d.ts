declare module 'lz4js' {
  export function decompress(b: Uint8Array, maxSize?: number): Uint8Array
  export function compress(b: Uint8Array, maxSize?: number): Uint8Array
  const lz4: { decompress: typeof decompress; compress: typeof compress }
  export default lz4
}
