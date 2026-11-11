// What the Asset View needs from main (PLAN-SLICING.md): the project's images with a thumbnail and the layers that use each one. Types only, no Node API.
export interface AssetUse { swf: string; nodeId: string; name: string }
export interface AssetInfo {
  hash: string
  width: number
  height: number
  /** The stored PNG as a data URL (drawn as is, scaled by the browser). */
  dataUrl: string
  usedBy: AssetUse[]
}
