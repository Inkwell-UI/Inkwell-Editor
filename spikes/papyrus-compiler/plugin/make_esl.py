"""Writes InkwellSpikes.esp: ESL-flagged, one start-game-enabled quest InkwellSpikeQuest with script Inkwell_SpikeWidget.
Hand-written from public record-format knowledge (UESP); UNVERIFIED in xEdit/CK/game. usage: python -I make_esl.py out.esp"""
import struct, sys
def sub(t, d): return t + struct.pack('<H', len(d)) + d
def rec(t, flags, fid, body): return t + struct.pack('<IIIIHH', len(body), flags, fid, 0, 44, 0) + body
def wstr(s): return struct.pack('<H', len(s)) + s.encode()
Z = b'\x00'
QID = 0x01000800  # master index 1 (= this file, after the SkyUI master); 0x800+ is the ESL-legal range
vmad = struct.pack('<hhH', 5, 2, 1) + wstr('Inkwell_SpikeWidget') + struct.pack('<BH', 0, 0) \
     + struct.pack('<BH', 2, 0) + wstr('') + struct.pack('<H', 0)  # no properties; no fragments; no aliases
quest = rec(b'QUST', 0, QID, sub(b'EDID', b'InkwellSpikeQuest' + Z) + sub(b'VMAD', vmad)
            + sub(b'DNAM', struct.pack('<HBBiI', 0x0001, 50, 0, 0, 0)) + sub(b'ANAM', struct.pack('<I', 0)))
grup = b'GRUP' + struct.pack('<I', 24 + len(quest)) + b'QUST' + struct.pack('<IIHH', 0, 0, 0, 0) + quest
hedr = (sub(b'HEDR', struct.pack('<fII', 1.71, 1, 0x801)) + sub(b'CNAM', b'Inkwell' + Z)
        + sub(b'MAST', b'SkyUI_SE.esp' + Z) + sub(b'DATA', struct.pack('<Q', 0)))
tes4 = rec(b'TES4', 0x200, 0, hedr)  # 0x200 = ESL flag
open(sys.argv[1], 'wb').write(tes4 + grup)
