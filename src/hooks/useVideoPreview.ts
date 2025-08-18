import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Player from 'xgplayer'
import HlsPlugin from 'xgplayer-hls'

export type VideoPreviewOptions = {
  width?: number
  height?: number
  frameStep?: number // seconds per step when scrubbing fast
}

export type UseVideoPreviewReturn = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  setPreviewSource: (url: string | null) => void
  onScrub: (timeInSeconds: number) => void
  previewSize: { width: number; height: number }
  isReady: boolean
}

export function useVideoPreview(options?: VideoPreviewOptions): UseVideoPreviewReturn {
  const { width = 160, height = 90, frameStep = 0.25 } = options || {}

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const previewPlayerRef = useRef<Player | null>(null)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)

  const previewSize = useMemo(() => ({ width, height }), [width, height])

  // Init worker
  useEffect(() => {
    const worker = new Worker('/preview-worker.js')
    workerRef.current = worker
    worker.postMessage({ type: 'init', width, height })
    const handleMessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || !canvasRef.current) return
      if (data.type === 'inited') {
        setIsReady(true)
      }
      if (data.type === 'frame') {
        const ctx = canvasRef.current.getContext('2d')
        if (!ctx) return
        const bitmap: ImageBitmap = data.bitmap
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        canvasRef.current.width = data.width
        canvasRef.current.height = data.height
        // draw the processed bitmap to the visible canvas
        // drawImage with ImageBitmap is very fast
        ctx.drawImage(bitmap, 0, 0)
        if (typeof bitmap.close === 'function') bitmap.close()
      }
    }
    worker.addEventListener('message', handleMessage)
    return () => {
      worker.removeEventListener('message', handleMessage)
      worker.terminate()
      workerRef.current = null
    }
  }, [width, height])

  // Manage hidden xgplayer for preview-only seeking (does not affect main player)
  useEffect(() => {
    if (!sourceUrl) return
    // Destroy existing
    if (previewPlayerRef.current) {
      try {
        previewPlayerRef.current.offAll()
        previewPlayerRef.current.destroy()
      } catch (error) {
        console.debug('preview player destroy error', error)
      }
      previewPlayerRef.current = null
    }
    if (previewContainerRef.current) {
      previewContainerRef.current.remove()
      previewContainerRef.current = null
    }

    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '-10000px'
    container.style.width = '1px'
    container.style.height = '1px'
    const containerId = `preview-player-${Date.now()}`
    container.id = containerId
    document.body.appendChild(container)
    previewContainerRef.current = container

    const p = new Player({
      id: containerId,
      url: sourceUrl,
      fluid: false,
      width: 1,
      height: 1,
      autoplay: false,
      controls: false,
      muted: true,
      playsinline: true as unknown as boolean,
      lang: 'zh-cn',
      plugins: [HlsPlugin],
      ignores: ['download'],
    })
    previewPlayerRef.current = p

    const handleReady = () => {
      // xgplayer exposes video element
      const playerWithVideo = p as unknown as { video?: HTMLVideoElement }
      const videoEl = playerWithVideo.video
      if (videoEl) {
        previewVideoRef.current = videoEl
      }
    }
    p.on('ready', handleReady)

    return () => {
      p.off('ready', handleReady)
      try {
        p.offAll()
        p.destroy()
      } catch (error) {
        console.debug('preview player cleanup error', error)
      }
      previewPlayerRef.current = null
      previewVideoRef.current = null
      if (previewContainerRef.current) {
        previewContainerRef.current.remove()
        previewContainerRef.current = null
      }
    }
  }, [sourceUrl])

  // Throttle rapid scrubs by stepping video.currentTime discretely
  const lastRequestedTimeRef = useRef<number>(0)

  const produceFrame = useCallback(async () => {
    const video = previewVideoRef.current
    const worker = workerRef.current
    const canvas = canvasRef.current
    if (!video || !worker || !canvas) return

    try {
      // Create a bitmap directly from the <video> for zero-copy when possible
      const bitmap = await createImageBitmap(video)
      worker.postMessage({ type: 'render', bitmap, width, height }, [
        bitmap as unknown as Transferable,
      ])
    } catch {
      // Fallback: draw via 2d canvas then transfer
      const tmp = document.createElement('canvas')
      tmp.width = video.videoWidth
      tmp.height = video.videoHeight
      const ctx = tmp.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        const bitmap = await createImageBitmap(tmp)
        workerRef.current?.postMessage({ type: 'render', bitmap, width, height }, [
          bitmap as unknown as Transferable,
        ])
      }
    }
  }, [width, height])

  const onScrub = useCallback(
    (timeInSeconds: number) => {
      const video = previewVideoRef.current
      if (!video) return
      // metadata ready
      if (!isFinite(video.duration) || video.readyState < 1) return
      if (Math.abs(timeInSeconds - lastRequestedTimeRef.current) < frameStep) return
      lastRequestedTimeRef.current = timeInSeconds

      const target = Math.min(Math.max(timeInSeconds, 0), Math.max(0, video.duration - 0.05))
      const handleSeeked = () => {
        video.removeEventListener('seeked', handleSeeked)
        produceFrame()
      }
      video.addEventListener('seeked', handleSeeked, { once: true })
      try {
        video.currentTime = target
      } catch {
        video.removeEventListener('seeked', handleSeeked)
      }
    },
    [frameStep, produceFrame],
  )

  const setPreviewSource = useCallback((url: string | null) => {
    setSourceUrl(url)
  }, [])

  return { canvasRef, setPreviewSource, onScrub, previewSize, isReady }
}

export default useVideoPreview
