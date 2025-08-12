import { useParams, useNavigate } from 'react-router'
import { useSearch } from '@/hooks'
import { apiService } from '@/services/api.service'
import { useState, useEffect, useRef } from 'react'
import { type VideoItem } from '@/types'
import { useApiStore } from '@/store/apiStore'
import { Card, CardFooter, Image, CardHeader, Chip } from '@heroui/react'

export default function SearchResult() {
  const abortCtrlRef = useRef<AbortController | null>(null)
  const { selectedAPIs, selectAllAPIs, customAPIs } = useApiStore()
  const navigate = useNavigate()

  const { query } = useParams()
  const { search, setSearch, searchMovie } = useSearch()
  const [searchRes, setSearchRes] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(false)
  // 首批结果就绪标识（用于弱网优化：首批到达即停止 loading）
  const firstBatchDoneRef = useRef(false)

  // 调用搜索内容
  const fetchSearchRes = async () => {
    if (!search) return
    // 取消上一次未完成的搜索
    abortCtrlRef.current?.abort()
    const controller = new AbortController()
    abortCtrlRef.current = controller
    setLoading(true)
    setSearchRes([])
    firstBatchDoneRef.current = false
    try {
      await apiService.aggregatedSearch(
        search,
        selectedAPIs,
        customAPIs,
        newResults => {
          // 首批结果到达时立刻结束 loading，提升首屏可用性
          if (!firstBatchDoneRef.current && newResults.length > 0) {
            firstBatchDoneRef.current = true
            setLoading(false)
          }
          setSearchRes(prevResults => {
            const allResults = [...prevResults, ...newResults]
            allResults.sort((a, b) => {
              const nameCompare = (a.vod_name || '').localeCompare(b.vod_name || '')
              if (nameCompare !== 0) return nameCompare
              return (a.source_name || '').localeCompare(b.source_name || '')
            })
            return allResults
          })
        },
        controller.signal,
      )
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('搜索已取消')
      } else {
        console.error('搜索时发生错误:', error)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (query && query !== search) {
      setSearch(query)
      searchMovie(query)
    }
  }, [query])

  useEffect(() => {
    // TODO: 临时调试代码 - 选中所有源（不包括成人源）
    // 只在默认状态（只选中黑木耳）时才自动选中所有源
    if (selectedAPIs.length === 1 && selectedAPIs[0] === 'heimuer') {
      console.log('[DEBUG] 检测到默认配置，自动选中所有非成人源')
      selectAllAPIs(true) // true 表示排除成人源
    }
    if (search) {
      fetchSearchRes()
    }
  }, [search])

  // 组件卸载时取消未完成的搜索
  useEffect(() => {
    return () => {
      abortCtrlRef.current?.abort()
    }
  }, [])

  // 处理卡片点击
  const handleCardClick = (item: VideoItem) => {
    // 导航到视频详情页，传递必要的参数
    navigate(`/detail/${item.source_code}/${item.vod_id}`, {
      state: { videoItem: item },
    })
  }

  return (
    <div className="p-4">
      {/* 搜索信息 */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold">
          搜索 "{search}" 的结果
          {searchRes && ` (${searchRes.length}个)`}
        </h2>
        <p className="mt-1 text-sm text-gray-600">搜索结果来自 {selectedAPIs.length} 个源</p>
        {loading && <p className="mt-2 text-gray-500">正在从各资源站玩命搜索中...</p>}
      </div>

      {/* 搜索结果网格 */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {searchRes?.map((item, index) => (
          <Card
            key={`${item.source_code}_${item.vod_id}_${index}`}
            isPressable
            isFooterBlurred
            onPress={() => handleCardClick(item)}
            className="w-full border-none transition-transform hover:scale-105"
            radius="lg"
          >
            <CardHeader className="absolute top-1 z-10 flex-col items-start p-3">
              <div className="rounded-large bg-black/20 px-2 py-1 backdrop-blur">
                <p className="text-tiny font-bold text-white/80 uppercase">{item.source_name}</p>
              </div>
              {item.vod_remarks && (
                <Chip
                  size="sm"
                  color="warning"
                  variant="flat"
                  className="bg-warning/80 mt-2 backdrop-blur"
                >
                  {item.vod_remarks}
                </Chip>
              )}
            </CardHeader>
            <Image
              removeWrapper
              alt={item.vod_name}
              className="z-0 h-[320px] w-full object-cover"
              src={
                item.vod_pic || 'https://placehold.jp/30/ffffff/000000/300x450.png?text=暂无封面'
              }
            />
            <CardFooter className="rounded-large shadow-small absolute bottom-1 z-10 ml-1 w-[calc(100%_-_8px)] justify-between overflow-hidden border-1 border-white/20 py-2 backdrop-blur before:rounded-xl before:bg-white/10">
              <div className="flex flex-grow flex-col gap-1 px-1">
                <p className="text-tiny text-white/80">
                  {item.type_name} · {item.vod_year}
                </p>
                <p className="line-clamp-2 text-sm font-semibold text-white">{item.vod_name}</p>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* 无结果提示 */}
      {!loading && searchRes?.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-gray-500">没有找到相关内容</p>
        </div>
      )}
    </div>
  )
}
