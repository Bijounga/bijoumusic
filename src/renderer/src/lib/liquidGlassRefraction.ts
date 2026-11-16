// Liquid Glass edge refraction, ported from the handoff's liquid-glass-refraction.js.
// Each matching element gets an SVG filter whose displacement map is drawn for its own
// size and corner radius: a band along the rim bends the picture behind it inward, like
// the edge of a lens; the middle is undistorted. The theme CSS applies it as the pane's
// backdrop-filter (url(#id) + the blur) once this has set data-lg-refract on the element.
//
// Chromium only (Electron is). Elsewhere an unsupported url() in backdrop-filter would
// void the whole declaration, so startRefraction() does nothing outside Chromium.
// Use it on a few big panes, not on every control: each map is a canvas-drawn PNG.

const BAND = 34 // px of rim that bends
const SCALE = 70 // how far the rim bends the backdrop, px
const RES = 0.5 // map resolution (the filter scales it up smoothly)
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Done {
  id: string | null
  w: number
  h: number
}

let svg: SVGSVGElement | null = null
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let seq = 0
let done = new WeakMap<Element, Done>()
let scanTimer: ReturnType<typeof setTimeout> | null = null
let selector = ''

const isChromium = (): boolean => /Electron|Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent)

function ensureSvg(): SVGSVGElement {
  if (svg) return svg
  const created = document.createElementNS(SVG_NS, 'svg')
  created.setAttribute('width', '0')
  created.setAttribute('height', '0')
  created.setAttribute('aria-hidden', 'true')
  created.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.appendChild(created)
  svg = created
  return created
}

/** The displacement map: R/G = 128 ± how far to look sideways for each pixel. */
function mapFor(w: number, h: number, radius: number): string {
  const mw = Math.max(2, Math.round(w * RES))
  const mh = Math.max(2, Math.round(h * RES))
  const canvas = document.createElement('canvas')
  canvas.width = mw
  canvas.height = mh
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(mw, mh)
  const d = img.data
  const hw = w / 2
  const hh = h / 2
  const r = Math.min(radius, hw, hh)
  // Signed distance to the rounded rectangle's edge (negative inside).
  const sdf = (x: number, y: number): number => {
    const qx = Math.abs(x - hw) - (hw - r)
    const qy = Math.abs(y - hh) - (hh - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const x = (i + 0.5) / RES
      const y = (j + 0.5) / RES
      const s = sdf(x, y)
      let dx = 0
      let dy = 0
      if (s > -BAND && s <= 0) {
        const gx = sdf(x + 1, y) - sdf(x - 1, y)
        const gy = sdf(x, y + 1) - sdf(x, y - 1)
        const gl = Math.hypot(gx, gy) || 1
        const t = 1 + s / BAND // 1 at the rim, 0 where the band ends
        const f = t * t * t // strongest at the edge, easing off inward
        dx = (-gx / gl) * f // look inward: the rim magnifies what's just inside it
        dy = (-gy / gl) * f
      }
      const k = (j * mw + i) * 4
      d[k] = Math.round(128 + dx * 127)
      d[k + 1] = Math.round(128 + dy * 127)
      d[k + 2] = 128
      d[k + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

function apply(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (w < 40 || h < 40) return
  const prev = done.get(el)
  if (prev && prev.w === w && prev.h === h) return
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
  const id = prev?.id ?? 'lg-refract-' + ++seq
  const root = ensureSvg()
  let filter = root.querySelector('#' + id)
  if (!filter) {
    filter = document.createElementNS(SVG_NS, 'filter')
    filter.setAttribute('id', id)
    filter.setAttribute('filterUnits', 'userSpaceOnUse')
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse')
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    const image = document.createElementNS(SVG_NS, 'feImage')
    image.setAttribute('result', 'map')
    image.setAttribute('preserveAspectRatio', 'none')
    const displacement = document.createElementNS(SVG_NS, 'feDisplacementMap')
    displacement.setAttribute('in', 'SourceGraphic')
    displacement.setAttribute('in2', 'map')
    displacement.setAttribute('xChannelSelector', 'R')
    displacement.setAttribute('yChannelSelector', 'G')
    displacement.setAttribute('scale', String(SCALE))
    filter.append(image, displacement)
    root.appendChild(filter)
  }
  const box: [string, number][] = [['x', 0], ['y', 0], ['width', w], ['height', h]]
  for (const [k, v] of box) filter.setAttribute(k, String(v))
  const image = filter.querySelector('feImage')
  if (image) {
    for (const [k, v] of box) image.setAttribute(k, String(v))
    image.setAttribute('href', mapFor(w, h, radius))
  }
  done.set(el, { id, w, h })
  el.dataset.lgRefract = id
  el.style.setProperty('--lg-refract', 'url(#' + id + ')')
}

function scan(): void {
  scanTimer = null
  if (!resizeObserver) return
  for (const el of document.querySelectorAll(selector)) {
    if (!done.has(el)) {
      done.set(el, { id: null, w: 0, h: 0 })
      resizeObserver.observe(el) // the first ResizeObserver report draws the map, later ones redraw it
    }
  }
}

export function startRefraction(sel: string): void {
  if (resizeObserver || !isChromium()) return
  selector = sel
  resizeObserver = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target as HTMLElement)))
  // Panes can come and go: look again shortly after the page changes.
  mutationObserver = new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(scan, 300)
  })
  mutationObserver.observe(document.body, { childList: true, subtree: true })
  scan()
}

export function stopRefraction(): void {
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  resizeObserver = null
  mutationObserver = null
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = null
  done = new WeakMap()
  for (const el of document.querySelectorAll<HTMLElement>('[data-lg-refract]')) {
    el.style.removeProperty('--lg-refract')
    delete el.dataset.lgRefract
  }
  svg?.remove()
  svg = null
}
