// Minimal plugin writer for a HUD widget mod. Record layouts (UESP, Skyrim SE; hand-written, loaded fine in game in the 0.0 spike, not yet checked in xEdit/CK):
//
//   record  = type[4] dataSize:u32 flags:u32 formId:u32 vcInfo:u32 version:u16 (44) unknown:u16, then dataSize bytes of subrecords
//   subrec  = type[4] size:u16 data
//   GRUP    = 'GRUP' groupSize:u32 (including this 24-byte header) label[4] groupType:u32 (0 = top level) stamp:u16 unknown:u16 version:u16 unknown:u16, then its records
//   TES4    = flags 0x200 (ESL); HEDR{version f32 1.71, numRecords u32, nextObjectId u32}, CNAM author, MAST master (+ DATA u64 0 per master)
//   QUST    = EDID, VMAD, DNAM{flags u16 0x0001 start game enabled, priority u8, unk u8, unk i32, type u32}, ANAM{nextAliasId u32}
//   VMAD    = version i16 (5), objectFormat i16 (2), scriptCount u16; per script: name wstring, status u8, propertyCount u16;
//             then the quest fragment block: u8 2, fragmentCount u16, scriptFileName wstring, aliasCount u16
//   wstring = u16 length + bytes
//
// FormID 0x01000800: load-order index 1 (the file itself, after the single master) with the ESL-legal local id range starting at 0x800.
const u16 = (v: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v)
  return b
}
const u32 = (v: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v)
  return b
}
const i16 = (v: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeInt16LE(v)
  return b
}
const cstr = (s: string): Buffer => Buffer.from(s + '\0', 'latin1')
const wstr = (s: string): Buffer => Buffer.concat([u16(s.length), Buffer.from(s, 'latin1')])
const sub = (t: string, d: Buffer): Buffer => Buffer.concat([Buffer.from(t, 'latin1'), u16(d.length), d])
const rec = (t: string, flags: number, formId: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from(t, 'latin1'), u32(body.length), u32(flags), u32(formId), u32(0), u16(44), u16(0), body])

export const ESL_FLAG = 0x200
export const QUEST_FORM_ID = 0x01000800
export const MASTER = 'SkyUI_SE.esp'

/** ESL-flagged ESP with master SkyUI_SE.esp and one start-game-enabled quest that has `scriptName` attached. */
export function buildEsp(o: { questEdid: string; scriptName: string; author?: string }): Buffer {
  const vmad = Buffer.concat([
    i16(5), i16(2), u16(1),
    wstr(o.scriptName), Buffer.from([0]), u16(0), // one script, status 0, no properties
    Buffer.from([2]), u16(0), wstr(''), u16(0) // no fragments, no aliases
  ])
  const dnam = Buffer.concat([u16(0x0001), Buffer.from([50, 0]), u32(0), u32(0)])
  const quest = rec('QUST', 0, QUEST_FORM_ID, Buffer.concat([sub('EDID', cstr(o.questEdid)), sub('VMAD', vmad), sub('DNAM', dnam), sub('ANAM', u32(0))]))
  const grup = Buffer.concat([Buffer.from('GRUP'), u32(24 + quest.length), Buffer.from('QUST'), u32(0), u32(0), u16(0), u16(0), quest])
  const hedr = Buffer.alloc(12)
  hedr.writeFloatLE(1.71, 0)
  hedr.writeUInt32LE(1, 4)
  hedr.writeUInt32LE(0x801, 8)
  const tes4 = rec('TES4', ESL_FLAG, 0, Buffer.concat([sub('HEDR', hedr), sub('CNAM', cstr(o.author ?? 'Inkwell')), sub('MAST', cstr(MASTER)), sub('DATA', Buffer.alloc(8))]))
  return Buffer.concat([tes4, grup])
}
