'use strict';

// Reads airport records out of a compiled scenery file (.bgl).
//
// Positional reads only: scenery BGLs run to gigabytes of model data, and all
// this needs is the header, the section table and the airport records, so a
// huge file costs a handful of small reads.
//
// File layout, little-endian:
//   header       magic at 0x00, header size at 0x04, section count at 0x14
//   section      20 bytes: type, size flag, subsection count, offset, size
//   subsection   16 or 20 bytes, decided by the section's size flag
//   airport      lon at 0x0c, lat at 0x10, ident at 0x28
//
// Two airport record types exist in the wild. 0x56 carries its ICAO ident.
// 0x113, written by newer tooling and used by most large payware airports,
// keeps the same coordinates but does not store the ident in the record or
// anywhere else in the file, so `ident` is null and the caller has to work it
// out from the package. See inferIdents() in ../scenery.js.

const fsp = require('node:fs/promises');

const MAGIC = 0x19920201;
const SECTION_AIRPORT = 0x03;
const SECTION_SIZE = 20;
const RECORD_HEAD = 0x30;

// Bounds on what a corrupt or hostile file can make the reader do.
const MAX_SECTIONS = 4096;
const MAX_SUBSECTIONS = 1024;
const MAX_RECORDS = 256;

/** Idents are base 38 above five flag bits: 0 space, 2-11 digits, 12-37 letters. */
function decodeIdent(value) {
  let rest = value >>> 5;
  let out = '';
  while (rest > 0) {
    const digit = rest % 38;
    rest = Math.floor(rest / 38);
    if (digit === 0) out = ` ${out}`;
    else if (digit >= 2 && digit <= 11) out = String(digit - 2) + out;
    else if (digit >= 12) out = String.fromCharCode(65 + digit - 12) + out;
    else return null;
  }
  const ident = out.trim();
  return /^[A-Z0-9]{2,6}$/.test(ident) ? ident : null;
}

function decodeLatitude(raw) {
  return 90 - (raw * 180) / (2 * 0x10000000);
}

function decodeLongitude(raw) {
  return (raw * 360) / (3 * 0x10000000) - 180;
}

async function readAt(file, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
}

/** Airport records in one subsection's data block. */
async function readRecords(file, offset, size, count, sink) {
  let position = offset;
  const end = offset + size;
  const limit = Math.min(count || 1, MAX_RECORDS);

  for (let index = 0; index < limit && position + RECORD_HEAD <= end; index += 1) {
    const record = await readAt(file, position, RECORD_HEAD);
    if (!record) return;
    const recordSize = record.readUInt32LE(2);
    if (recordSize < RECORD_HEAD) return;

    const lat = decodeLatitude(record.readUInt32LE(0x10));
    const lon = decodeLongitude(record.readUInt32LE(0x0c));
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      sink.push({ ident: decodeIdent(record.readUInt32LE(0x28)), lat, lon });
    }
    position += recordSize;
  }
}

async function readAirportSection(file, section, sink) {
  const subsectionSize = ((section.sizeFlag & 0x10000) | 0x40000) >> 14;
  const count = Math.min(section.subsections, MAX_SUBSECTIONS);

  for (let index = 0; index < count; index += 1) {
    const sub = await readAt(file, section.offset + index * subsectionSize, subsectionSize);
    if (!sub) return;
    // The longer form has a wider id; the last three fields match.
    const tail = subsectionSize - 12;
    await readRecords(file, sub.readUInt32LE(tail + 4), sub.readUInt32LE(tail + 8), sub.readUInt32LE(tail), sink);
  }
}

/**
 * @param {string} path
 * @returns {Promise<{ valid: boolean, sections: number[], airports: object[] }>}
 *   `sections` lists the section types present, which says what kind of
 *   content the file holds even when it has no airport in it.
 */
async function readBgl(path) {
  const result = { valid: false, sections: [], airports: [] };
  let file;
  try {
    file = await fsp.open(path, 'r');
    const head = await readAt(file, 0, 0x38);
    if (!head || head.readUInt32LE(0) !== MAGIC) return result;

    const count = Math.min(head.readUInt32LE(0x14), MAX_SECTIONS);
    const table = await readAt(file, head.readUInt32LE(4), count * SECTION_SIZE);
    if (!table) return result;
    result.valid = true;

    for (let index = 0; index < count; index += 1) {
      const at = index * SECTION_SIZE;
      const type = table.readUInt32LE(at);
      result.sections.push(type);
      if (type !== SECTION_AIRPORT) continue;
      await readAirportSection(
        file,
        {
          sizeFlag: table.readUInt32LE(at + 4),
          subsections: table.readUInt32LE(at + 8),
          offset: table.readUInt32LE(at + 12),
        },
        result.airports,
      );
    }
  } catch {
    // A missing, locked or malformed file is simply not a source of airports.
  } finally {
    if (file) await file.close().catch(() => {});
  }
  return result;
}

module.exports = { readBgl, decodeIdent, decodeLatitude, decodeLongitude };
