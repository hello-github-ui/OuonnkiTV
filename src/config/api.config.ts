// API 源配置
export interface ApiSite {
  api: string
  name: string
  detail?: string
  adult?: boolean
}

export const API_SITES: Record<string, ApiSite> = {
  heimuer: {
    api: 'https://json.heimuer.xyz',
    name: '黑木耳',
    detail: 'https://heimuer.tv',
  },
  ffzy: {
    api: 'http://api.ffzyapi.com',
    name: '非凡影视',
    detail: 'http://api.ffzyapi.com',
  },
  tyyszy: {
    api: 'https://tyyszy.com',
    name: '天涯资源',
  },
  ckzy: {
    api: 'https://www.ckzy1.com',
    name: 'CK资源',
    adult: true,
  },
  zy360: {
    api: 'https://360zy.com',
    name: '360资源',
  },
  wolong: {
    api: 'https://wolongzyw.com',
    name: '卧龙资源',
  },
  cjhw: {
    api: 'https://cjhwba.com',
    name: '新华为',
  },
  jisu: {
    api: 'https://jszyapi.com',
    name: '极速资源',
    detail: 'https://jszyapi.com',
  },
  bfzy: {
    api: 'https://bfzyapi.com',
    name: '暴风资源',
  },
  mozhua: {
    api: 'https://mozhuazy.com',
    name: '魔爪资源',
  },
  mdzy: {
    api: 'https://www.mdzyapi.com',
    name: '魔都资源',
  },
  ruyi: {
    api: 'https://cj.rycjapi.com',
    name: '如意资源',
  },

  // 成人资源站
  jkun: {
    api: 'https://jkunzyapi.com',
    name: 'jkun资源',
    adult: true,
  },
  bwzy: {
    api: 'https://api.bwzym3u8.com',
    name: '百万资源',
    adult: true,
  },
  souav: {
    api: 'https://api.souavzy.vip',
    name: 'souav资源',
    adult: true,
  },
  siwa: {
    api: 'https://siwazyw.tv',
    name: '丝袜资源',
    adult: true,
  },
  r155: {
    api: 'https://155api.com',
    name: '155资源',
    adult: true,
  },
  lsb: {
    api: 'https://apilsbzy1.com',
    name: 'lsb资源',
    adult: true,
  },
  huangcang: {
    api: 'https://hsckzy.vip',
    name: '黄色仓库',
    adult: true,
    detail: 'https://hsckzy.vip',
  },
}

// API 配置
export const API_CONFIG = {
  search: {
    path: '/api.php/provide/vod/?ac=videolist&wd=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '/api.php/provide/vod/?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
}

// 其他配置
// 优先使用环境变量中的代理URL，如果没有则使用默认值
export const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://cors.zme.ink/'
export const SEARCH_HISTORY_KEY = 'videoSearchHistory'
export const MAX_HISTORY_ITEMS = 5
export const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g

export const PLAYER_CONFIG = {
  autoplay: true,
  allowFullscreen: true,
  width: '100%',
  height: '600',
  timeout: 15000,
  filterAds: true,
  autoPlayNext: true,
  adFilteringEnabled: true,
  adFilteringStorage: 'adFilteringEnabled',
}

export const AGGREGATED_SEARCH_CONFIG = {
  enabled: true,
  timeout: 8000,
  maxResults: 10000,
  parallelRequests: true,
  showSourceBadges: true,
  // Top-K 先达：首批使用的最快来源数量
  topKFirstBatch: 4,
  // 是否在收到 Top-K 首批后中断其余慢源（默认仅首批优先，不中断其余）
  earlyAbortAfterTopK: false,
  // 并发控制：基础/最小/最大
  baseConcurrency: 3,
  minConcurrency: 1,
  maxConcurrency: 6,
}

export const CUSTOM_API_CONFIG = {
  separator: ',',
  maxSources: 5,
  testTimeout: 5000,
  namePrefix: 'Custom-',
  validateUrl: true,
  cacheResults: true,
  cacheExpiry: 5184000000,
  adultPropName: 'isAdult',
}

export const HIDE_BUILTIN_ADULT_APIS = false
