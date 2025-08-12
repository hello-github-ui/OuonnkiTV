import {
  API_SITES,
  API_CONFIG,
  PROXY_URL,
  M3U8_PATTERN,
  AGGREGATED_SEARCH_CONFIG,
} from '@/config/api.config'
import type { SearchResponse, DetailResponse, VideoItem, CustomApi } from '@/types'

class ApiService {
  // 简单的源健康度记录与请求去重缓存
  private sourceHealth: Map<
    string,
    {
      avgLatencyMs: number
      successCount: number
      failureCount: number
      lastLatencyMs: number
      lastUpdatedAt: number
    }
  > = new Map()

  private inflightRequests: Map<string, Promise<SearchResponse>> = new Map()

  private persistHealthKey = 'ouonnki-tv-source-health'

  constructor() {
    // 加载历史健康度（若存在）
    try {
      const str = localStorage.getItem(this.persistHealthKey)
      if (str) {
        const obj = JSON.parse(str)
        if (obj && typeof obj === 'object') {
          this.sourceHealth = new Map(Object.entries(obj)) as unknown as Map<
            string,
            {
              avgLatencyMs: number
              successCount: number
              failureCount: number
              lastLatencyMs: number
              lastUpdatedAt: number
            }
          >
        }
      }
    } catch {}
  }

  private saveHealth() {
    try {
      const obj: Record<string, unknown> = {}
      for (const [k, v] of this.sourceHealth.entries()) obj[k] = v
      localStorage.setItem(this.persistHealthKey, JSON.stringify(obj))
    } catch {}
  }

  private updateHealth(sourceCode: string, ok: boolean, latencyMs: number) {
    const rec = this.sourceHealth.get(sourceCode) || {
      avgLatencyMs: latencyMs,
      successCount: 0,
      failureCount: 0,
      lastLatencyMs: latencyMs,
      lastUpdatedAt: Date.now(),
    }
    rec.lastLatencyMs = latencyMs
    rec.lastUpdatedAt = Date.now()
    if (ok) {
      rec.successCount += 1
      // 指数平滑
      rec.avgLatencyMs = rec.avgLatencyMs * 0.7 + latencyMs * 0.3
    } else {
      rec.failureCount += 1
      // 失败也稍微拉高平均延迟
      rec.avgLatencyMs = rec.avgLatencyMs * 0.8 + latencyMs * 0.2
    }
    this.sourceHealth.set(sourceCode, rec)
    this.saveHealth()
  }

  private getSourceScore(sourceCode: string): number {
    const rec = this.sourceHealth.get(sourceCode)
    if (!rec) return 0
    const total = rec.successCount + rec.failureCount
    const successRate = total > 0 ? rec.successCount / total : 0.5
    const latencyScore = 1 / Math.max(100, rec.avgLatencyMs) // 延迟越小，分越高
    return successRate * 0.7 + latencyScore * 0.3
  }

  private getNetworkFactor(): number {
    // 默认 1；弱网返回 < 1
    const nav = navigator as any
    const conn = nav && nav.connection
    if (conn && typeof conn.effectiveType === 'string') {
      const type = conn.effectiveType as string
      if (type === 'slow-2g' || type === '2g') return 0.4
      if (type === '3g') return 0.7
      if (type === '4g') return 1
    }
    return 1
  }

  private getAdaptiveConcurrency(selectedAPIs: string[]): number {
    const base = AGGREGATED_SEARCH_CONFIG.baseConcurrency ?? 3
    const min = AGGREGATED_SEARCH_CONFIG.minConcurrency ?? 1
    const max = AGGREGATED_SEARCH_CONFIG.maxConcurrency ?? 6
    const netFactor = this.getNetworkFactor()

    // 根据最近错误率动态调整（简单策略：失败较多则减并发）
    let failureRatio = 0
    let total = 0
    for (const id of selectedAPIs) {
      const rec = this.sourceHealth.get(id)
      if (rec) {
        total += rec.successCount + rec.failureCount
        failureRatio += rec.failureCount
      }
    }
    failureRatio = total > 0 ? failureRatio / total : 0
    const healthFactor = Math.max(0.6, 1 - failureRatio) // 失败越多，系数越低，最低 0.6

    const c = Math.round(base * netFactor * healthFactor)
    return Math.min(max, Math.max(min, c))
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeout = 10000,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    } finally {
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  // 搜索视频
  async searchVideos(
    query: string,
    source: string,
    customApi?: string,
    signal?: AbortSignal,
    timeoutMs: number = AGGREGATED_SEARCH_CONFIG.timeout || 8000,
  ): Promise<SearchResponse> {
    try {
      if (!query) {
        throw new Error('缺少搜索参数')
      }

      // 验证 API 源
      if (source === 'custom' && !customApi) {
        throw new Error('使用自定义API时必须提供API地址')
      }

      if (!API_SITES[source] && source !== 'custom') {
        throw new Error('无效的API来源')
      }

      const apiUrl = customApi
        ? `${customApi}${API_CONFIG.search.path}${encodeURIComponent(query)}`
        : `${API_SITES[source].api}${API_CONFIG.search.path}${encodeURIComponent(query)}`

      // 请求去重（相同 URL + query）
      const requestKey = PROXY_URL + encodeURIComponent(apiUrl)
      const exec = async () => {
        const start = performance.now()
        try {
          const response = await this.fetchWithTimeout(
            requestKey,
            {
              headers: API_CONFIG.search.headers,
            },
            timeoutMs,
            signal,
          )

          if (!response.ok) {
            throw new Error(`API请求失败: ${response.status}`)
          }

          const data = await response.json()

          if (!data || !Array.isArray(data.list)) {
            throw new Error('API返回的数据格式无效')
          }

          // 添加源信息到每个结果
          data.list.forEach((item: VideoItem) => {
            item.source_name = source === 'custom' ? '自定义源' : API_SITES[source].name
            item.source_code = source
            if (source === 'custom') {
              item.api_url = customApi
            }
          })

          const end = performance.now()
          this.updateHealth(source, true, end - start)

          return {
            code: 200,
            list: data.list || [],
          } as SearchResponse
        } catch (err) {
          const end = performance.now()
          this.updateHealth(source, false, end - start)
          throw err
        } finally {
          // 完成后移除去重 key
          this.inflightRequests.delete(requestKey)
        }
      }

      if (!this.inflightRequests.has(requestKey)) {
        this.inflightRequests.set(requestKey, exec())
      }

      const result = await this.inflightRequests.get(requestKey)!

      return result
    } catch (error) {
      console.error('搜索错误:', error)
      return {
        code: 400,
        msg: error instanceof Error ? error.message : '请求处理失败',
        list: [],
      }
    }
  }

  // 获取视频详情
  async getVideoDetail(
    id: string,
    sourceCode: string,
    customApi?: string,
  ): Promise<DetailResponse> {
    try {
      if (!id) {
        throw new Error('缺少视频ID参数')
      }

      // 验证ID格式
      if (!/^[\w-]+$/.test(id)) {
        throw new Error('无效的视频ID格式')
      }

      // 验证API源
      if (sourceCode === 'custom' && !customApi) {
        throw new Error('使用自定义API时必须提供API地址')
      }

      if (!API_SITES[sourceCode] && sourceCode !== 'custom') {
        throw new Error('无效的API来源')
      }

      // 特殊源处理
      if (sourceCode === 'huangcang' && API_SITES[sourceCode].detail) {
        return await this.handleSpecialSourceDetail(id, sourceCode)
      }

      const detailUrl = customApi
        ? `${customApi}${API_CONFIG.detail.path}${id}`
        : `${API_SITES[sourceCode].api}${API_CONFIG.detail.path}${id}`

      const response = await this.fetchWithTimeout(PROXY_URL + encodeURIComponent(detailUrl), {
        headers: API_CONFIG.detail.headers,
      })

      if (!response.ok) {
        throw new Error(`详情请求失败: ${response.status}`)
      }

      const data = await response.json()

      if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
        throw new Error('获取到的详情内容无效')
      }

      const videoDetail = data.list[0]
      let episodes: string[] = []

      // 提取播放地址
      if (videoDetail.vod_play_url) {
        const playSources = videoDetail.vod_play_url.split('$$$')
        if (playSources.length > 0) {
          const mainSource = playSources[playSources.length - 1]
          const episodeList = mainSource.split('#')

          episodes = episodeList
            .map((ep: string) => {
              const parts = ep.split('$')
              return parts.length > 1 ? parts[1] : ''
            })
            .filter(
              (url: string) => url && (url.startsWith('http://') || url.startsWith('https://')),
            )
        }
      }

      // 如果没有找到播放地址，尝试使用正则表达式
      if (episodes.length === 0 && videoDetail.vod_content) {
        const matches = videoDetail.vod_content.match(M3U8_PATTERN) || []
        episodes = matches.map((link: string) => link.replace(/^\$/, ''))
      }

      return {
        code: 200,
        episodes,
        detailUrl,
        videoInfo: {
          title: videoDetail.vod_name,
          cover: videoDetail.vod_pic,
          desc: videoDetail.vod_content,
          type: videoDetail.type_name,
          year: videoDetail.vod_year,
          area: videoDetail.vod_area,
          director: videoDetail.vod_director,
          actor: videoDetail.vod_actor,
          remarks: videoDetail.vod_remarks,
          source_name: sourceCode === 'custom' ? '自定义源' : API_SITES[sourceCode].name,
          source_code: sourceCode,
        },
      }
    } catch (error) {
      console.error('详情获取错误:', error)
      return {
        code: 400,
        msg: error instanceof Error ? error.message : '请求处理失败',
        episodes: [],
      }
    }
  }

  // 处理特殊源详情
  private async handleSpecialSourceDetail(id: string, sourceCode: string): Promise<DetailResponse> {
    try {
      const detailUrl = `${API_SITES[sourceCode].detail}/index.php/vod/detail/id/${id}.html`

      const response = await this.fetchWithTimeout(PROXY_URL + encodeURIComponent(detailUrl), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      })

      if (!response.ok) {
        throw new Error(`详情页请求失败: ${response.status}`)
      }

      const html = await response.text()
      let matches: string[] = []

      if (sourceCode === 'ffzy') {
        const ffzyPattern = /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g
        matches = html.match(ffzyPattern) || []
      }

      if (matches.length === 0) {
        const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g
        matches = html.match(generalPattern) || []
      }

      // 去重
      matches = [...new Set(matches)]

      // 处理链接
      matches = matches.map(link => {
        link = link.substring(1)
        const parenIndex = link.indexOf('(')
        return parenIndex > 0 ? link.substring(0, parenIndex) : link
      })

      // 提取标题和简介
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/)
      const titleText = titleMatch ? titleMatch[1].trim() : ''

      const descMatch = html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/)
      const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').trim() : ''

      return {
        code: 200,
        episodes: matches,
        detailUrl,
        videoInfo: {
          title: titleText,
          desc: descText,
          source_name: API_SITES[sourceCode].name,
          source_code: sourceCode,
        },
      }
    } catch (error) {
      console.error(`${API_SITES[sourceCode].name}详情获取失败:`, error)
      throw error
    }
  }

  // 并发控制辅助函数
  private createConcurrencyLimiter(limit: number) {
    let running = 0
    const queue: (() => void)[] = []

    const tryRun = () => {
      while (running < limit && queue.length > 0) {
        const next = queue.shift()
        if (next) {
          running++
          next()
        }
      }
    }

    return <T>(task: () => Promise<T>): Promise<T> => {
      return new Promise((resolve, reject) => {
        const run = () => {
          task()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              running--
              tryRun()
            })
        }

        queue.push(run)
        tryRun()
      })
    }
  }

  // 聚合搜索（支持 AbortSignal、并发控制和增量渲染）
  aggregatedSearch(
    query: string,
    selectedAPIs: string[],
    customAPIs: CustomApi[],
    onNewResults: (results: VideoItem[]) => void,
    signal?: AbortSignal,
  ): Promise<void[]> {
    if (selectedAPIs.length === 0) {
      console.warn('没有选中任何 API 源')
      return Promise.resolve([])
    }

    let aborted = false
    if (signal) {
      if (signal.aborted) {
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', () => {
        aborted = true
      })
    }

    const seen = new Set<string>()

    // 动态并发
    const dynamicLimit = this.getAdaptiveConcurrency(selectedAPIs)
    const limiter = this.createConcurrencyLimiter(dynamicLimit)

    // 源排序：优先健康、低延迟
    const orderedAPIs = [...selectedAPIs].sort(
      (a, b) => this.getSourceScore(b) - this.getSourceScore(a),
    )

    // Top-K 先达控制
    const topK = Math.max(1, AGGREGATED_SEARCH_CONFIG.topKFirstBatch ?? 4)
    let reachedTopK = 0
    const perSourceControllers = new Map<string, AbortController>()
    const abortRest = () => {
      for (const [, c] of perSourceControllers) c.abort()
    }
    if (signal) {
      // 全局取消时同时取消每个源
      signal.addEventListener('abort', abortRest, { once: true })
    }

    const tasks = orderedAPIs.map(apiId =>
      limiter(async () => {
        if (aborted) return
        let results: VideoItem[] = []
        const perCtrl = new AbortController()
        perSourceControllers.set(apiId, perCtrl)
        // 绑定外部取消
        if (signal) {
          if (signal.aborted) perCtrl.abort()
          else signal.addEventListener('abort', () => perCtrl.abort(), { once: true })
        }
        try {
          if (apiId.startsWith('custom_')) {
            const idx = parseInt(apiId.replace('custom_', ''))
            const customApi = customAPIs[idx]
            if (customApi) {
              results = await this.searchSingleSource(
                query,
                'custom',
                customApi.url,
                customApi.name,
                perCtrl.signal,
              )
            }
          } else if (API_SITES[apiId]) {
            results = await this.searchSingleSource(
              query,
              apiId,
              undefined,
              undefined,
              perCtrl.signal,
            )
          }
        } catch (error) {
          if (aborted) return
          if ((error as Error).name !== 'AbortError') console.warn(`${apiId} 源搜索失败:`, error)
        } finally {
          perSourceControllers.delete(apiId)
        }
        if (aborted) return

        const newUnique = results.filter(item => {
          const key = `${item.source_code}_${item.vod_id}`
          if (!seen.has(key)) {
            seen.add(key)
            return true
          }
          return false
        })

        if (newUnique.length > 0) {
          reachedTopK += 1
          onNewResults(newUnique)
          if (AGGREGATED_SEARCH_CONFIG.earlyAbortAfterTopK && reachedTopK >= topK && !aborted) {
            abortRest()
          }
        }
      }),
    )

    const allPromise = Promise.all(tasks)
    if (signal) {
      const abortPromise = new Promise<void[]>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
      return Promise.race([allPromise, abortPromise])
    }
    return allPromise
  }

  // 搜索单个源
  private async searchSingleSource(
    query: string,
    source: string,
    customApi?: string,
    customName?: string,
    signal?: AbortSignal,
  ): Promise<VideoItem[]> {
    try {
      const result = await this.searchVideos(query, source, customApi, signal)
      if (result.code === 200 && result.list) {
        // 如果是自定义源，更新源名称
        if (source === 'custom' && customName) {
          result.list.forEach(item => {
            item.source_name = customName
          })
        }
        return result.list
      }
      return []
    } catch (error) {
      console.warn(`${source}源搜索失败:`, error)
      return []
    }
  }
}

export const apiService = new ApiService()
