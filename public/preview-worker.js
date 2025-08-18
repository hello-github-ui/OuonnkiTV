// Lightweight worker to resize frames off the main thread using OffscreenCanvas
// Messages:
// - { type: 'init', width, height } → set default output size
// - { type: 'render', bitmap, width?, height? } → draw and return ImageBitmap
// - { type: 'clear' } → clear canvas

let offscreenCanvas = null
let offscreenCtx = null
let defaultWidth = 160
let defaultHeight = 90

function ensureCanvas(width, height) {
  if (!offscreenCanvas) {
    offscreenCanvas = new OffscreenCanvas(width, height)
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: false })
  } else if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = width
    offscreenCanvas.height = height
  }
}

self.onmessage = async event => {
  const data = event.data || {}
  const type = data.type

  try {
    if (type === 'init') {
      defaultWidth = Number(data.width) || defaultWidth
      defaultHeight = Number(data.height) || defaultHeight
      ensureCanvas(defaultWidth, defaultHeight)
      self.postMessage({ type: 'inited', width: defaultWidth, height: defaultHeight })
      return
    }

    if (type === 'render') {
      const bitmap = data.bitmap
      if (!bitmap) return
      const width = Number(data.width) || defaultWidth
      const height = Number(data.height) || defaultHeight
      ensureCanvas(width, height)

      // Draw frame
      offscreenCtx.clearRect(0, 0, width, height)
      offscreenCtx.drawImage(bitmap, 0, 0, width, height)

      // Return bitmap to main thread
      const frameBitmap = offscreenCanvas.transferToImageBitmap()
      self.postMessage({ type: 'frame', bitmap: frameBitmap, width, height }, [frameBitmap])

      // Close input bitmap to free memory
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close()
      }
      return
    }

    if (type === 'clear') {
      if (offscreenCtx && offscreenCanvas) {
        offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height)
      }
      self.postMessage({ type: 'cleared' })
      return
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: String(error && error.message ? error.message : error),
    })
  }
}
