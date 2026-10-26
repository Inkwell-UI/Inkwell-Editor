// DirectInput scan codes (DIK_*), the key numbers of the menu JSON `triggers.hotkey` and the INI `OpenKey` (SPEC-CHANGES S1, S2). 1 (Escape) is reserved by the runtime.

export interface ScanKey {
  code: number
  name: string
}

const range = (names: string, first: readonly number[]): ScanKey[] => [...names].map((name, i) => ({ code: first[i]!, name }))

/** Keys offered by the picker, in the order they are listed. Any other code from 2 to 255 can still be typed. */
export const SCAN_KEYS: readonly ScanKey[] = [
  ...range('1234567890', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  ...range('QWERTYUIOP', [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]),
  ...range('ASDFGHJKL', [30, 31, 32, 33, 34, 35, 36, 37, 38]),
  ...range('ZXCVBNM', [44, 45, 46, 47, 48, 49, 50]),
  ...[59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88].map((code, i) => ({ code, name: `F${i + 1}` })),
  { code: 15, name: 'Tab' }, { code: 57, name: 'Space' }, { code: 28, name: 'Enter' }, { code: 14, name: 'Backspace' }, { code: 41, name: 'Grave (`)' },
  { code: 12, name: 'Minus' }, { code: 13, name: 'Equals' }, { code: 26, name: 'Left bracket' }, { code: 27, name: 'Right bracket' }, { code: 39, name: 'Semicolon' },
  { code: 40, name: 'Apostrophe' }, { code: 43, name: 'Backslash' }, { code: 51, name: 'Comma' }, { code: 52, name: 'Period' }, { code: 53, name: 'Slash' },
  { code: 200, name: 'Up arrow' }, { code: 208, name: 'Down arrow' }, { code: 203, name: 'Left arrow' }, { code: 205, name: 'Right arrow' },
  { code: 199, name: 'Home' }, { code: 207, name: 'End' }, { code: 201, name: 'Page Up' }, { code: 209, name: 'Page Down' }, { code: 210, name: 'Insert' }, { code: 211, name: 'Delete' },
  ...[82, 79, 80, 81, 75, 76, 77, 71, 72, 73].map((code, i) => ({ code, name: `Numpad ${i}` }))
]

export const scanKeyName = (code: number): string | undefined => SCAN_KEYS.find((k) => k.code === code)?.name

/** `K (37)`, or just the number for a key the picker does not know. */
export const scanKeyLabel = (code: number): string => {
  const n = scanKeyName(code)
  return n ? `${n} (${code})` : String(code)
}
