// Packs the two Premiere panels into build-premiere/ so electron-builder can ship
// them inside the app (extraResources -> resources/premiere). Runs before every
// package (beforePack) and can be run by hand: `node scripts/build-premiere-bundle.cjs`.
//
//   BijouMusic-Premiere-Panel.ccx   the UXP panel, an installable package (a zip with
//                                   the panel's files at its root)
//   com.bijoumusic.cutsilence/      the CEP panel, ready to copy into Adobe's
//                                   extensions folder
//
// Both get the app's own version number, so the app can tell an out-of-date install
// from a current one by comparing versions.

const { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('fs')
const { join, relative, sep } = require('path')
const zlib = require('zlib')

const root = join(__dirname, '..')

function skip(name) {
  return name === 'README.md' || name.includes('.backup-')
}

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (skip(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A plain zip file (deflate), from [{ name, data }]. */
function makeZip(entries) {
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = zlib.deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, packed)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(dosTime, 12)
    entry.writeUInt16LE(dosDate, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuf)
    offset += local.length + nameBuf.length + packed.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, end])
}

function build() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  const out = join(root, 'build-premiere')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  // UXP panel -> .ccx
  const panelDir = join(root, 'premiere-extension')
  const entries = listFiles(panelDir).map((file) => {
    const name = relative(panelDir, file).split(sep).join('/')
    let data = readFileSync(file)
    if (name === 'manifest.json') {
      data = Buffer.from(readFileSync(file, 'utf8').replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`))
    }
    return { name, data }
  })
  writeFileSync(join(out, 'BijouMusic-Premiere-Panel.ccx'), makeZip(entries))

  // CEP panel -> folder, versions stamped
  const cepOut = join(out, 'com.bijoumusic.cutsilence')
  cpSync(join(root, 'premiere-cep-extension'), cepOut, { recursive: true, filter: (src) => !skip(src.split(sep).pop()) })
  const manifestPath = join(cepOut, 'CSXS', 'manifest.xml')
  if (existsSync(manifestPath)) {
    const xml = readFileSync(manifestPath, 'utf8')
      .replace(/(ExtensionBundleVersion=")[^"]*(")/, `$1${version}$2`)
      .replace(/(<Extension Id="[^"]*" Version=")[^"]*(")/, `$1${version}$2`)
    writeFileSync(manifestPath, xml)
  }
  console.log(`[premiere bundle] built panels for v${version} in build-premiere/`)
}

module.exports = async function beforePack() {
  build()
}

if (require.main === module) build()
