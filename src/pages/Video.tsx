import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import Player from 'xgplayer'
import HlsPlugin from 'xgplayer-hls'
import 'xgplayer/dist/index.min.css'
import { Card, CardHeader, CardBody, Button, Chip, Spinner } from '@heroui/react'
import type { DetailResponse, VideoItem } from '@/types'
import { apiService } from '@/services/api.service'
import { useApiStore } from '@/store/apiStore'
import { useViewingHistoryStore } from '@/store/viewingHistoryStore'
import _ from 'lodash'
import VideoProgressPreview from '@/components/VideoProgressPreview'
import { useVideoPreview } from '@/hooks'

export default function Video() {
  const location = useLocation()
  const navigate = useNavigate()
  const { sourceCode, vodId, episodeIndex } = useParams<{
    sourceCode: string
    vodId: string
    episodeIndex: string
  }>()

  const playerRef = useRef<Player | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { canvasRef, setPreviewSource, onScrub, previewSize } = useVideoPreview({
    width: 180,
    height: 101,
  })
  const [previewLeft, setPreviewLeft] = useState(0)
  const [previewVisible, setPreviewVisible] = useState(false)

  // 从 store 获取自定义 API 配置
  const { customAPIs } = useApiStore()
  const { addViewingHistory, viewingHistory } = useViewingHistoryStore()

  // 状态管理
  const [detail, setDetail] = useState<DetailResponse | null>(location.state?.detail || null)
  const [videoItem, setVideoItem] = useState<VideoItem | undefined>(location.state?.videoItem)
  const [selectedEpisode, setSelectedEpisode] = useState(() => {
    const index = parseInt(episodeIndex || '0')
    return isNaN(index) ? 0 : index
  })
  const [loading, setLoading] = useState(!location.state?.detail)
  const [error, setError] = useState<string | null>(null)

  // 获取显示信息
  const getTitle = () => videoItem?.vod_name || detail?.videoInfo?.title || '未知视频'
  const sourceName = videoItem?.source_name || detail?.videoInfo?.source_name || '未知来源'

  // 获取视频详情
  useEffect(() => {
    const fetchVideoDetail = async () => {
      if (!sourceCode || !vodId) {
        setError('缺少必要的参数')
        return
      }

      // 如果已有数据，不需要重新获取
      if (detail && detail.episodes && detail.episodes.length > 0) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        let customApi: string | undefined

        // 处理自定义 API 源
        if (sourceCode?.startsWith('custom_')) {
          const customIndex = parseInt(sourceCode.replace('custom_', ''))
          const customApiConfig = customAPIs[customIndex]
          if (customApiConfig) {
            customApi = customApiConfig.url
          } else {
            throw new Error('找不到对应的自定义 API 配置')
          }
        }

        // 获取视频详情
        const response = await apiService.getVideoDetail(vodId, sourceCode, customApi)

        if (response.code === 200 && response.episodes && response.episodes.length > 0) {
          setDetail(response)
          // 如果没有 videoItem，使用 response 中的信息
          if (!videoItem && response.videoInfo) {
            setVideoItem({
              vod_id: vodId,
              vod_name: response.videoInfo.title,
              vod_pic: response.videoInfo.cover,
              vod_remarks: response.videoInfo.remarks,
              type_name: response.videoInfo.type,
              vod_year: response.videoInfo.year,
              vod_area: response.videoInfo.area,
              vod_director: response.videoInfo.director,
              vod_actor: response.videoInfo.actor,
              vod_content: response.videoInfo.desc,
              source_name: response.videoInfo.source_name,
              source_code: response.videoInfo.source_code,
              api_url: customApi,
            })
          }
        } else {
          throw new Error(response.msg || '获取视频详情失败')
        }
      } catch (err) {
        console.error('获取视频详情失败:', err)
        setError(err instanceof Error ? err.message : '获取视频详情失败')
      } finally {
        setLoading(false)
      }
    }

    fetchVideoDetail()
  }, [sourceCode, vodId, detail, videoItem, customAPIs])

  // 监听 selectedEpisode 和 URL 参数变化
  useEffect(() => {
    const urlEpisodeIndex = parseInt(episodeIndex || '0')
    if (!isNaN(urlEpisodeIndex) && urlEpisodeIndex !== selectedEpisode) {
      setSelectedEpisode(urlEpisodeIndex)
    }
  }, [episodeIndex])

  useEffect(() => {
    if (!detail?.episodes || !detail.episodes[selectedEpisode]) return

    // 销毁旧的播放器实例
    if (playerRef.current) {
      playerRef.current.destroy()
    }

    // 创建新的播放器实例
    playerRef.current = new Player({
      id: 'player',
      url: detail.episodes[selectedEpisode],
      fluid: true,
      playbackRate: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
      pip: true,
      lang: 'zh-cn',
      plugins: [HlsPlugin],
      ignores: ['download'],
    })

    // 设置预览数据源：使用隐藏预览播放器进行独立 seek，不影响主播放器
    setPreviewSource(detail.episodes[selectedEpisode])

    // 自动续播
    const existingHistory = viewingHistory.find(
      item =>
        item.sourceCode === sourceCode &&
        item.vodId === vodId &&
        item.episodeIndex === selectedEpisode,
    )
    if (existingHistory) {
      playerRef.current.currentTime = existingHistory.playbackPosition || 0
    }

    // 记录观看历史
    const player = playerRef.current
    const normalAddHistory = () => {
      if (!sourceCode || !vodId) return
      addViewingHistory({
        title: getTitle(),
        imageUrl: videoItem?.vod_pic || '',
        sourceCode: sourceCode || '',
        vodId: vodId || '',
        episodeIndex: selectedEpisode,
        playbackPosition: player.currentTime || 0,
        duration: player.duration || 0,
        timestamp: Date.now(),
      })
    }

    player.on('play', normalAddHistory)
    player.on('pause', normalAddHistory)
    player.on('ended', normalAddHistory)

    let lastTimeUpdate = 0
    const TIME_UPDATE_INTERVAL = 3000

    const timeUpdateHandler = () => {
      if (!sourceCode || !vodId) return
      const currentTime = player.currentTime || 0
      const duration = player.duration || 0
      const timeSinceLastUpdate = Date.now() - lastTimeUpdate

      if (timeSinceLastUpdate >= TIME_UPDATE_INTERVAL && currentTime > 0 && duration > 0) {
        lastTimeUpdate = Date.now()
        addViewingHistory({
          title: getTitle(),
          imageUrl: videoItem?.vod_pic || '',
          sourceCode: sourceCode || '',
          vodId: vodId || '',
          episodeIndex: selectedEpisode,
          playbackPosition: currentTime,
          duration: duration,
          timestamp: Date.now(),
        })
      }
    }

    player.on('timeupdate', _.throttle(timeUpdateHandler, TIME_UPDATE_INTERVAL))

    // 清理函数
    return () => {
      if (playerRef.current) {
        normalAddHistory()
        player.offAll()
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [selectedEpisode, detail, sourceCode, vodId, addViewingHistory])

  // 绑定进度条悬停事件，控制预览
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 可能的进度条选择器（不同版本样式有所差异）
    const trySelectors = [
      '.xgplayer-progress',
      '.xgplayer-progress-outer',
      '.xgplayer_progress',
      '[data-index="progress"]',
    ]
    let progressEl: HTMLElement | null = null
    for (const sel of trySelectors) {
      const el = container.querySelector(sel) as HTMLElement | null
      if (el) {
        progressEl = el
        break
      }
    }
    // 如果找不到，退化为整个控制条区域
    if (!progressEl) {
      progressEl = container as HTMLElement
    }

    let rafPending = false
    const handleMove = (ev: PointerEvent) => {
      if (!playerRef.current) return
      const rect = progressEl!.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const percent = Math.min(1, Math.max(0, x / rect.width))
      const time = (playerRef.current.duration || 0) * percent

      setPreviewVisible(true)
      setPreviewLeft(rect.left + x - containerRect.left)

      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        onScrub(time)
      })
    }
    const handleEnter = () => setPreviewVisible(true)
    const handleLeave = () => setPreviewVisible(false)

    progressEl.addEventListener('pointermove', handleMove, { passive: true })
    progressEl.addEventListener('pointerenter', handleEnter, { passive: true })
    progressEl.addEventListener('pointerleave', handleLeave, { passive: true })

    return () => {
      progressEl?.removeEventListener('pointermove', handleMove)
      progressEl?.removeEventListener('pointerenter', handleEnter)
      progressEl?.removeEventListener('pointerleave', handleLeave)
    }
  }, [selectedEpisode, detail, onScrub])

  // 处理集数切换
  const handleEpisodeChange = (index: number) => {
    setSelectedEpisode(index)
    // 更新 URL，保持路由同步
    navigate(`/video/${sourceCode}/${vodId}/${index}`, {
      replace: true,
      state: { detail, videoItem },
    })
  }

  // 加载状态
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-gray-500">正在加载视频信息...</p>
        </div>
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardBody className="text-center">
            <p className="mb-4 text-red-500">{error}</p>
            <Button className="w-full" onPress={() => navigate(-1)} variant="flat">
              返回
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  // 如果没有数据，显示错误信息
  if (!detail || !detail.episodes || detail.episodes.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardBody className="text-center">
            <p className="mb-4 text-gray-500">无法获取播放信息</p>
            <Button className="w-full" onPress={() => navigate(-1)} variant="flat">
              返回
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl p-2 sm:p-4">
      {/* 视频信息 - 移动端在播放器上方，桌面端浮层 */}
      <div className="mb-4 flex flex-col gap-2 md:hidden">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-600">{sourceName}</p>
            <h4 className="text-lg font-bold">{getTitle()}</h4>
          </div>
          <Button size="sm" variant="flat" onPress={() => navigate(-1)}>
            返回
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Chip size="sm" color="primary" variant="flat">
            第 {selectedEpisode + 1} 集
          </Chip>
          <p className="text-sm text-gray-600">共 {detail.episodes.length} 集</p>
        </div>
      </div>

      {/* 播放器卡片 */}
      <Card className="mb-4 border-none sm:mb-6" radius="lg">
        <CardHeader className="absolute top-1 z-10 hidden w-full p-3 md:block">
          <div className="flex w-full items-start justify-between">
            <div className="rounded-large bg-black/20 px-3 py-2 backdrop-blur">
              <p className="text-tiny font-bold text-white/80 uppercase">{sourceName}</p>
              <h4 className="text-lg font-medium text-white">{getTitle()}</h4>
            </div>
            <div className="rounded-large flex items-center gap-2 bg-black/20 px-3 py-2 backdrop-blur">
              <Chip size="sm" variant="flat" className="bg-white/20 backdrop-blur">
                第 {selectedEpisode + 1} 集
              </Chip>
              <p className="text-tiny text-white/80">共 {detail.episodes.length} 集</p>
              <Button
                size="sm"
                className="text-tiny ml-2 bg-black/20 text-white"
                radius="lg"
                variant="flat"
                onPress={() => navigate(-1)}
              >
                返回
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <div className="relative">
            <div
              id="player"
              ref={containerRef}
              className="aspect-video w-full rounded-lg bg-black"
            />
            <VideoProgressPreview
              ref={canvasRef}
              width={previewSize.width}
              height={previewSize.height}
              left={previewLeft}
              visible={previewVisible}
            />
          </div>
        </CardBody>
      </Card>

      {/* 选集列表 */}
      <Card isBlurred className="bg-background/60 dark:bg-default-100/50 border-none" radius="lg">
        <CardHeader>
          <h3 className="text-lg font-bold md:text-xl">选集</h3>
        </CardHeader>
        <CardBody>
          <div className="xs:grid-cols-4 grid grid-cols-3 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {detail.episodes.map((_, index) => (
              <Button
                key={index}
                size="sm"
                className={
                  selectedEpisode === index
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-default-100 hover:bg-default-200'
                }
                variant={selectedEpisode === index ? 'solid' : 'flat'}
                onPress={() => handleEpisodeChange(index)}
              >
                <span className="text-xs sm:text-sm">{index + 1}</span>
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
