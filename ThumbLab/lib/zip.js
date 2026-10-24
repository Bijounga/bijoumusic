// Minimal zip reader: just enough to pull one entry (Procreate's QuickLook thumbnail).
const zlib = require("zlib");

function readEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(pos + 10);
    const csize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(local + 26);
      const lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

module.exports = { readEntry };
