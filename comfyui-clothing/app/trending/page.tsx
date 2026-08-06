"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import Image from "next/image"
import type { StaticImageData } from "next/image"
import { FolderOpen, Loader2 } from "lucide-react"
import type { Locale } from "@/lib/i18n/translations"
import { useI18n } from "@/contexts/i18n-context"

import oldMoneyLook1 from "@/image/trending/old_money_aesthetic/2025-12-09/1_The_Heritage_Blazer.png"
import oldMoneyLook2 from "@/image/trending/old_money_aesthetic/2025-12-09/2_Country_Club_Chic.png"
import oldMoneyLook3 from "@/image/trending/old_money_aesthetic/2025-12-09/3_Gala_Grace.png"
import oldMoneyLook4 from "@/image/trending/old_money_aesthetic/2025-12-09/4_Quiet_Luxury_Layering.png"
import oldMoneyLook5 from "@/image/trending/old_money_aesthetic/2025-12-09/5_The_Timeless_Trench.png"

import parisLook1 from "@/image/trending/paris_fashion_week_2025/2025-12-09/1_The_Grand_Volume_Statement.png"
import parisLook2 from "@/image/trending/paris_fashion_week_2025/2025-12-09/2_Lustrous_Aquatic_Chroma.png"
import parisLook3 from "@/image/trending/paris_fashion_week_2025/2025-12-09/3_Refined_Artisanal_Bohemia.png"
import parisLook4 from "@/image/trending/paris_fashion_week_2025/2025-12-09/4_Deconstructed_Asymmetric_Tailoring.png"
import parisLook5 from "@/image/trending/paris_fashion_week_2025/2025-12-09/5_Sculptural_Sheer_Layers.png"

import avantLook1 from "@/image/trending/avant_garde_minimalism/2025-12-09/1_Deconstructed_Volumes.png"
import avantLook2 from "@/image/trending/avant_garde_minimalism/2025-12-09/2_Architectural_Lines.png"
import avantLook3 from "@/image/trending/avant_garde_minimalism/2025-12-09/3_Monochromatic_Textural_Play.png"
import avantLook4 from "@/image/trending/avant_garde_minimalism/2025-12-09/4_Strategic_Cut_outs___Negative_Space.png"
import avantLook5 from "@/image/trending/avant_garde_minimalism/2025-12-09/5_Asymmetrical_Draping.png"

import ecoLook1 from "@/image/trending/eco_futurism/2025-12-09/1_Bioluminescent_Organica.png"
import ecoLook2 from "@/image/trending/eco_futurism/2025-12-09/2_Geo_Sculptural_Upcycling.png"
import ecoLook3 from "@/image/trending/eco_futurism/2025-12-09/3_Adaptive_Bio_Techwear.png"
import ecoLook4 from "@/image/trending/eco_futurism/2025-12-09/4_Verdant_Digital_Prints.png"
import ecoLook5 from "@/image/trending/eco_futurism/2025-12-09/5_Reclaimed_Architectural_Avant_Garde.png"

type LocalizedText = Record<Locale, string>

const localized = (en: string, zh: string): LocalizedText => ({
  en,
  zh,
})

type Trend = {
  id: string
  name: string
  description: string
  image: StaticImageData
}

type LocalizedTrendDefinition = {
  id: string
  name: LocalizedText
  description: LocalizedText
  image: StaticImageData
}

type CollectionTag = {
  key: string
  label: string
}

type LocalizedTagDefinition = {
  key: string
  label: LocalizedText
}

type Collection = {
  id: string
  timestamp: number
  query: string
  category: string
  categoryKey: string
  season: string
  seasonKey: string
  tags: CollectionTag[]
  summary: string
  trends: Trend[]
}

type LocalizedCollectionDefinition = {
  id: string
  timestamp: number
  query: LocalizedText
  category: {
    key: string
    label: LocalizedText
  }
  season: {
    key: string
    label: LocalizedText
  }
  tags: LocalizedTagDefinition[]
  summary: LocalizedText
  trends: LocalizedTrendDefinition[]
}

type ReportCard = {
  id: string
  headline: string
  generated_at: string
  markdown_path: string
  content: string
}

type StorageEntry =
  | string
  | {
      original?: string | null
      localPath?: string | null
      path?: string | null
      thumbnail?: string | null
    }

type TaskHistoryItemLite = {
  id?: number | string
  tenant_task_id?: string | null
  task_type?: string | null
  result_data?: unknown
  storage_paths?: StorageEntry[] | null
  image_urls?: string[] | null
  created_at?: string | null
}

type BaokuanPackage = {
  tenantTaskId: string
  collectionId: string
  batchId?: string
  imageCount: number
  imageUrls: string[]
  createdAt?: string
  trendName?: string
}

const TRENDING_COLLECTION_DEFINITIONS: LocalizedCollectionDefinition[] = [
  {
    id: "collection-old-money",
    timestamp: Date.parse("2025-12-09T08:00:00Z"),
    query: localized("Old Money Aesthetic Revival", "旧钱风格复兴"),
    category: {
      key: "category-ready-to-wear",
      label: localized("Ready-to-Wear Muse", "成衣灵感"),
    },
    season: {
      key: "season-2025-fw",
      label: localized("FW 2025", "2025 秋冬"),
    },
    tags: [
      { key: "style-quiet-luxury", label: localized("Quiet Luxury", "静奢") },
      { key: "tag-equestrian", label: localized("Equestrian Accents", "马术元素") },
      { key: "tag-handcrafted", label: localized("Handcrafted Details", "手工细节") },
    ],
    summary: localized(
      "Camel, ivory, and deep indigo reinterpret quiet luxury with couture shoulders, hand-stitched seams, and plush textures.",
      "以高级驼色、象牙白与深靛蓝重新演绎静奢风格，强调定制肩线、手工缝线与珍稀材质的温润质感。",
    ),
    trends: [
      {
        id: "trend-old-money-1",
        name: localized("The Heritage Blazer", "传承西装"),
        description: localized(
          "Double-breasted mohair blazer with sharp shoulders, gold buttons, and a tonal silk scarf.",
          "复古双排扣马海毛西装外套，肩部贴合利落，搭配金色钮扣与同色调丝巾。",
        ),
        image: oldMoneyLook1,
      },
      {
        id: "trend-old-money-2",
        name: localized("Country Club Chic", "马术俱乐部层次"),
        description: localized(
          "Diamond-stitch vest layered over crisp shirt and pleated skirt, cinched by an equestrian belt.",
          "菱格针织背心叠穿挺括衬衫与百褶裙，马术风腰带勾勒出柔和腰线。",
        ),
        image: oldMoneyLook2,
      },
      {
        id: "trend-old-money-3",
        name: localized("Gala Grace", "舞会优雅"),
        description: localized(
          "Satin strapless gown paired with a silk stole, finished with crystal buckle and pearl earrings.",
          "缎面抹胸礼裙搭配丝质披肩，钻扣与珍珠耳饰营造低调高光。",
        ),
        image: oldMoneyLook3,
      },
      {
        id: "trend-old-money-4",
        name: localized("Quiet Luxury Layering", "静奢叠穿"),
        description: localized(
          "Cashmere coat layered over chiffon dress, with sheer gloves echoing the airy texture.",
          "羊绒大衣叠穿雪纺连衣裙，半透明材质呼应手套的轻盈触感。",
        ),
        image: oldMoneyLook4,
      },
      {
        id: "trend-old-money-5",
        name: localized("The Timeless Trench", "经典风衣"),
        description: localized(
          "Beige trench with silk blouse and high-waist trousers, emphasized by a sculptural metal belt.",
          "经典米色风衣配合丝质衬衫与高腰裤，金属腰封强调结构。",
        ),
        image: oldMoneyLook5,
      },
    ],
  },
  {
    id: "collection-paris-week",
    timestamp: Date.parse("2025-12-09T08:00:00Z"),
    query: localized("Paris Fashion Week Highlights", "巴黎时装周精选"),
    category: {
      key: "category-runway",
      label: localized("Runway Dispatch", "T台速递"),
    },
    season: {
      key: "season-2026-ss",
      label: localized("SS 2026", "2026 春夏"),
    },
    tags: [
      { key: "style-haute-couture", label: localized("Haute Couture", "高定") },
      { key: "style-sculptural", label: localized("Sculptural Volume", "雕塑廓形") },
      { key: "style-aurora", label: localized("Aurora Chrome", "极光色") },
    ],
    summary: localized(
      "Five standout looks from Paris mix palace-level volume with oceanic chrome, balancing opulence and experimentation.",
      "巴黎时装周上最受关注的五组造型，从宫廷级堆叠到海面金属光泽，呈现奢华与实验的平衡。",
    ),
    trends: [
      {
        id: "trend-paris-1",
        name: localized("The Grand Volume Statement", "雕塑体量宣言"),
        description: localized(
          "Gown builds sculpted mass at shoulders and neck while a corseted taffeta bodice keeps structure.",
          "礼服肩颈处打造雕塑般体量，胸衣使用硬挺塔夫绸支撑。",
        ),
        image: parisLook1,
      },
      {
        id: "trend-paris-2",
        name: localized("Lustrous Aquatic Chroma", "海域光泽"),
        description: localized(
          "Sea-blue metallic coating refracts light and is paired with cascading artisan beadwork.",
          "海水蓝金属涂层面料折射光线，搭配垂坠式手工珠串。",
        ),
        image: parisLook2,
      },
      {
        id: "trend-paris-3",
        name: localized("Refined Artisanal Bohemia", "波西米亚织锦"),
        description: localized(
          "Silk printed dress layered with a tasseled shawl that feels like an art-house jacquard.",
          "丝质印花连衣裙叠穿流苏披肩，手感仿若艺术织锦。",
        ),
        image: parisLook3,
      },
      {
        id: "trend-paris-4",
        name: localized("Deconstructed Asymmetric Tailoring", "解构非对称剪裁"),
        description: localized(
          "Ink-black suit exposes seams and asymmetric cuts to celebrate raw deconstruction.",
          "非对称剪裁的墨色套装，以裸露缝线展示拆解痕迹。",
        ),
        image: parisLook4,
      },
      {
        id: "trend-paris-5",
        name: localized("Sculptural Sheer Layers", "雕塑透纱层次"),
        description: localized(
          "Layered sheer mesh creates misty volume while a metal waist cincher locks focus.",
          "多层透纱营造迷雾感，金属腰封锁住腰部焦点。",
        ),
        image: parisLook5,
      },
    ],
  },
  {
    id: "collection-avant-garde",
    timestamp: Date.parse("2025-12-09T08:00:00Z"),
    query: localized("Avant Garde Minimalism", "前卫极简"),
    category: {
      key: "category-avant-structure",
      label: localized("Avant Structure", "前卫结构"),
    },
    season: {
      key: "season-2026-fw",
      label: localized("FW 2026", "2026 秋冬"),
    },
    tags: [
      { key: "style-deconstruction", label: localized("Deconstruction", "解构") },
      { key: "style-architectural", label: localized("Architectural Lines", "建筑线条") },
      { key: "style-monochrome", label: localized("Black & White", "黑白灰") },
      { key: "style-avant-garde", label: localized("Avant-garde", "前卫") },
      { key: "style-minimalism", label: localized("Minimalism", "极简") },
    ],
    summary: localized(
      "Architectural light and shadow inspire monochrome experiments that use sharp cut lines to rebalance form.",
      "以建筑光影为灵感的极简实验系列，利用大面积黑白灰与锐利切线重塑身形平衡。",
    ),
    trends: [
      {
        id: "trend-avant-1",
        name: localized("Deconstructed Volumes", "解构体量"),
        description: localized(
          "Layered stiff fabrics splice into a floating cape silhouette.",
          "解构式斗篷拼接多层硬挺面料，形成漂浮体量。",
        ),
        image: avantLook1,
      },
      {
        id: "trend-avant-2",
        name: localized("Architectural Lines", "建筑线条"),
        description: localized(
          "Panelled dress uses sharp linear blocking to carve depth and shadow.",
          "直线分割的拼接连衣裙，利用明暗面做出空间感。",
        ),
        image: avantLook2,
      },
      {
        id: "trend-avant-3",
        name: localized("Monochromatic Textural Play", "单色肌理"),
        description: localized(
          "Single-tone fabrics mix ribbed, felted, and smooth finishes for tactile minimalism.",
          "单色系面料叠加不同肌理，给极简造型注入触感。",
        ),
        image: avantLook3,
      },
      {
        id: "trend-avant-4",
        name: localized("Strategic Cut-outs & Negative Space", "负空间切割"),
        description: localized(
          "Negative-space panels with translucent mesh emphasize the body’s lines.",
          "切割露出的负空间与透明网纱拼接，强调身体线条。",
        ),
        image: avantLook4,
      },
      {
        id: "trend-avant-5",
        name: localized("Asymmetrical Draping", "非对称披褶"),
        description: localized(
          "Diagonal drapes and knotted hems shift the silhouette’s center of gravity.",
          "斜向褶裥和打结裙摆，使身形重心随步伐变换。",
        ),
        image: avantLook5,
      },
    ],
  },
  {
    id: "collection-eco-futurism",
    timestamp: Date.parse("2025-12-09T08:00:00Z"),
    query: localized("Eco Futurism", "生态未来派"),
    category: {
      key: "category-sustainable",
      label: localized("Sustainable Capsule", "可持续"),
    },
    season: {
      key: "season-2026-ss",
      label: localized("SS 2026", "2026 春夏"),
    },
    tags: [
      { key: "style-sustainable", label: localized("Sustainability", "可持续") },
      { key: "style-tech-fabric", label: localized("Tech Textiles", "科技织物") },
      { key: "style-nature", label: localized("Nature Muse", "自然灵感") },
      { key: "style-functional", label: localized("Functional Hybrid", "功能") },
    ],
    summary: localized(
      "Recycled materials and bio-inspired palettes blur the line between utilitarian wear and art installation.",
      "结合再生材质与仿生色彩的未来派单品，试图在功能服与艺术装置之间取得平衡。",
    ),
    trends: [
      {
        id: "trend-eco-1",
        name: localized("Bioluminescent Organica", "荧光仿生"),
        description: localized(
          "Gradient dress mimics deep-sea glow with micro LEDs trimming the edges.",
          "荧光渐变裙装仿照深海生物发光，边缘点缀微型LED。",
        ),
        image: ecoLook1,
      },
      {
        id: "trend-eco-2",
        name: localized("Geo Sculptural Upcycling", "几何拼折"),
        description: localized(
          "Recycled rigid textiles fold into geometric armor framing the neckline.",
          "再生硬质面料折成立体几何，构成护甲式领口。",
        ),
        image: ecoLook2,
      },
      {
        id: "trend-eco-3",
        name: localized("Adaptive Bio Techwear", "仿生机能"),
        description: localized(
          "Utility vest fuses transparent PVC and woven panels for experimental techwear.",
          "多口袋功能背心混合透明PVC与编织物，呈现实验感。",
        ),
        image: ecoLook3,
      },
      {
        id: "trend-eco-4",
        name: localized("Verdant Digital Prints", "绿色幻境"),
        description: localized(
          "Digital foliage prints and silk sheen feel like a wearable greenhouse.",
          "数字植被图案与丝绸光泽叠加，像是可穿戴的温室。",
        ),
        image: ecoLook4,
      },
      {
        id: "trend-eco-5",
        name: localized("Reclaimed Architectural Avant-Garde", "再生建筑感"),
        description: localized(
          "Reclaimed plastic panels build architectural shoulders against soft skirts.",
          "再生塑料板材构成建筑感肩部结构，与柔软裙摆对比。",
        ),
        image: ecoLook5,
      },
    ],
  },
]

const resolveCollections = (locale: Locale): Collection[] => {
  return TRENDING_COLLECTION_DEFINITIONS.map((definition) => ({
    id: definition.id,
    timestamp: definition.timestamp,
    query: definition.query[locale],
    category: definition.category.label[locale],
    categoryKey: definition.category.key,
    season: definition.season.label[locale],
    seasonKey: definition.season.key,
    tags: definition.tags.map((tag) => ({
      key: tag.key,
      label: tag.label[locale],
    })),
    summary: definition.summary[locale],
    trends: definition.trends.map((trend) => ({
      id: trend.id,
      name: trend.name[locale],
      description: trend.description[locale],
      image: trend.image,
    })),
  }))
}


function TrendDashboard({ history }: { history: Collection[] }) {
  const { locale, messages } = useI18n()
  const copy = messages.trending
  const localeCode = locale === "zh" ? "zh-CN" : "en-US"
  const [selectedFilter, setSelectedFilter] = useState("all")
  const [activeCollection, setActiveCollection] = useState<Collection | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [reportCards, setReportCards] = useState<ReportCard[]>([])
  const [reportLoading, setReportLoading] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [activeReport, setActiveReport] = useState<ReportCard | null>(null)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generatePreviewUrls, setGeneratePreviewUrls] = useState<string[]>([])
  const [generateTaskId, setGenerateTaskId] = useState<string | null>(null)
  const [baokuanHistory, setBaokuanHistory] = useState<BaokuanPackage[]>([])
  const [baokuanHistoryLoading, setBaokuanHistoryLoading] = useState(false)
  const [baokuanHistoryError, setBaokuanHistoryError] = useState<string | null>(null)
  const [baokuanHistoryFetched, setBaokuanHistoryFetched] = useState(false)
  const [packageModalCollectionId, setPackageModalCollectionId] = useState<string | null>(null)
  const [packageModalActiveIndex, setPackageModalActiveIndex] = useState(0)
  const [packagePreviewImage, setPackagePreviewImage] = useState<string | null>(null)
  const [isPreviewFadingIn, setIsPreviewFadingIn] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchReports = async () => {
      setReportLoading(true)
      setReportError(null)
      try {
        const response = await fetch("/api/trending/reports", { cache: "no-store" })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = await response.json()
        if (!cancelled) {
          setReportCards(Array.isArray(data?.reports) ? data.reports : [])
        }
      } catch (error) {
        console.error("Failed to load trend reports", error)
        if (!cancelled) {
          setReportError(copy.errors.reports)
          setReportCards([])
        }
      } finally {
        if (!cancelled) {
          setReportLoading(false)
        }
      }
    }

    fetchReports()

    return () => {
      cancelled = true
    }
  }, [copy.errors.reports])

  const packagesByCollection = useMemo(() => {
    const grouped: Record<string, BaokuanPackage[]> = {}
    for (const entry of baokuanHistory) {
      if (!entry.collectionId) continue
      if (!grouped[entry.collectionId]) {
        grouped[entry.collectionId] = []
      }
      grouped[entry.collectionId].push(entry)
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bTime - aTime
      })
    }
    return grouped
  }, [baokuanHistory])

  const loadBaokuanHistory = useCallback(async () => {
    if (baokuanHistoryFetched || baokuanHistoryLoading) {
      return
    }
    const storedToken =
      typeof window !== "undefined" ? localStorage.getItem("token") || localStorage.getItem("auth_token") : null
    if (!storedToken) {
      return
    }
    setBaokuanHistoryLoading(true)
    setBaokuanHistoryError(null)
    try {
      const response = await fetch("/api/proxy/tasks/history?task_type=trending_baokuan&limit=100", {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const payload = await response.json()
      const parsed: BaokuanPackage[] = Array.isArray(payload)
        ? payload
            .map((item) => normalizeTaskToPackage(item as TaskHistoryItemLite))
            .filter((item): item is BaokuanPackage => Boolean(item))
        : []
      setBaokuanHistory((previous) => {
        const merged = new Map<string, BaokuanPackage>()
        for (const entry of parsed) {
          merged.set(entry.tenantTaskId, entry)
        }
        for (const entry of previous) {
          if (!merged.has(entry.tenantTaskId)) {
            merged.set(entry.tenantTaskId, entry)
          }
        }
        return Array.from(merged.values())
      })
      setBaokuanHistoryFetched(true)
    } catch (error) {
      console.error("Failed to load history capsules", error)
      setBaokuanHistoryError(copy.errors.history)
    } finally {
      setBaokuanHistoryLoading(false)
    }
  }, [baokuanHistoryFetched, baokuanHistoryLoading, copy.errors.history])

  useEffect(() => {
    if (isModalOpen && activeCollection) {
      void loadBaokuanHistory()
    }
  }, [isModalOpen, activeCollection, loadBaokuanHistory])

  useEffect(() => {
    if (!packagePreviewImage) {
      setIsPreviewFadingIn(false)
      return
    }
    setIsPreviewFadingIn(false)
    const handle = requestAnimationFrame(() => setIsPreviewFadingIn(true))
    return () => cancelAnimationFrame(handle)
  }, [packagePreviewImage])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (packagePreviewImage) {
          setPackagePreviewImage(null)
          event.preventDefault()
          return
        }
        if (packageModalCollectionId) {
          handleClosePackageModal()
          event.preventDefault()
          return
        }
        if (isReportModalOpen) {
          handleCloseReportModal()
          event.preventDefault()
          return
        }
        if (isModalOpen) {
          handleCloseModal()
          event.preventDefault()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isModalOpen, isReportModalOpen, packageModalCollectionId, packagePreviewImage])

  const packageModalCount =
    packageModalCollectionId && packagesByCollection[packageModalCollectionId]
      ? packagesByCollection[packageModalCollectionId]!.length
      : 0

  useEffect(() => {
    if (!packageModalCollectionId) {
      return
    }
    if (packageModalCount === 0) {
      setPackageModalCollectionId(null)
      setPackageModalActiveIndex(0)
      return
    }
    if (packageModalActiveIndex >= packageModalCount) {
      setPackageModalActiveIndex(0)
    }
  }, [packageModalCollectionId, packageModalCount, packageModalActiveIndex])

  const filterGroups = useMemo(
    () => [
      {
        key: "style",
        title: copy.sidebar.groups.style,
        options: [
          { key: "style-quiet-luxury", label: copy.sidebar.filters.quietLuxury },
          { key: "style-avant-garde", label: copy.sidebar.filters.avantGarde },
          { key: "style-minimalism", label: copy.sidebar.filters.minimalism },
          { key: "style-functional", label: copy.sidebar.filters.functional },
        ],
      },
      {
        key: "season",
        title: copy.sidebar.groups.season,
        options: [
          { key: "season-2025-fw", label: copy.sidebar.filters.season2025fw },
          { key: "season-2026-ss", label: copy.sidebar.filters.season2026ss },
          { key: "season-2026-fw", label: copy.sidebar.filters.season2026fw },
        ],
      },
    ],
    [copy.sidebar],
  )

  const filterLabels = useMemo(() => {
    const map: Record<string, string> = { all: copy.sidebar.all }
    for (const group of filterGroups) {
      for (const option of group.options) {
        map[option.key] = option.label
      }
    }
    return map
  }, [copy.sidebar.all, filterGroups])

  const selectedFilterLabel = filterLabels[selectedFilter] ?? copy.sidebar.all

  const filteredHistory = useMemo(() => {
    if (selectedFilter === "all") {
      return history
    }
    return history.filter(
      (item) =>
        item.categoryKey === selectedFilter ||
        item.seasonKey === selectedFilter ||
        item.tags.some((tag) => tag.key === selectedFilter),
    )
  }, [history, selectedFilter])

  const handleCardClick = (collection: Collection) => {
    setActiveCollection(collection)
    setTimeout(() => setIsModalOpen(true), 10)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setIsGenerating(false)
    setGenerateError(null)
    setGeneratePreviewUrls([])
    setGenerateTaskId(null)
    setTimeout(() => setActiveCollection(null), 400)
  }

  const handleReportCardClick = (report: ReportCard) => {
    setActiveReport(report)
    setTimeout(() => setIsReportModalOpen(true), 10)
  }

  const handleCloseReportModal = () => {
    setIsReportModalOpen(false)
    setTimeout(() => setActiveReport(null), 400)
  }

  const handleOpenPackageModal = (collectionId: string) => {
    if (!packagesByCollection[collectionId] || packagesByCollection[collectionId]!.length === 0) {
      return
    }
    setPackageModalCollectionId(collectionId)
    setPackageModalActiveIndex(0)
  }

  const handleClosePackageModal = () => {
    setPackageModalCollectionId(null)
    setPackageModalActiveIndex(0)
  }

  const buildStaticImageUrl = (entry: unknown) => {
    if (!entry) return null
    let rawPath: string | null = null
    if (typeof entry === "string") {
      rawPath = entry
    } else if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>
      rawPath =
        typeof record.original === "string"
          ? record.original
          : typeof record.localPath === "string"
            ? record.localPath
            : null
    }
    if (!rawPath) return null
    const relative = rawPath.replace(/^\.?[\\/]{0,2}output[\\/]/i, "").replace(/\\/g, "/")
    if (!relative) return null
    return `/api/proxy/static/images/${relative}`
  }

  const getTrendImageSrc = (trend: Trend): string | null => {
    if (!trend) return null
    if (typeof trend.image === "string") {
      return trend.image
    }
    if (trend.image && typeof trend.image === "object" && "src" in trend.image && typeof trend.image.src === "string") {
      return trend.image.src
    }
    return null
  }

  const loadTrendImageDataUrl = async (trend: Trend): Promise<string | null> => {
    if (typeof window === "undefined") {
      return null
    }
    const src = getTrendImageSrc(trend)
    if (!src) {
      return null
    }
    try {
      const absoluteUrl = src.startsWith("http") ? src : new URL(src, window.location.origin).toString()
      const response = await fetch(absoluteUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch reference image (${response.status})`)
      }
      const blob = await response.blob()
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result)
          } else {
            reject(new Error("Invalid reference image payload"))
          }
        }
        reader.onerror = () => reject(new Error("Failed to read reference image"))
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      console.error("Failed to load reference image", error)
      return null
    }
  }

  const parseResultPayload = (value: unknown): Record<string, unknown> | null => {
    if (!value) return null
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>
        }
      } catch {
        return null
      }
      return null
    }
    if (typeof value === "object") {
      return value as Record<string, unknown>
    }
    return null
  }

  const getTaskImageUrls = (task: TaskHistoryItemLite): string[] => {
    if (Array.isArray(task.image_urls)) {
      const direct = task.image_urls.filter((url): url is string => typeof url === "string" && url.length > 0)
      if (direct.length > 0) {
        return direct
      }
    }
    const storageEntries: StorageEntry[] = Array.isArray(task.storage_paths) ? task.storage_paths : []
    const urls: string[] = []
    for (const entry of storageEntries) {
      const candidate = buildStaticImageUrl(entry)
      if (candidate) {
        urls.push(candidate)
      }
    }
    return urls
  }

  const normalizeTaskToPackage = (task: TaskHistoryItemLite): BaokuanPackage | null => {
    if (task.task_type && task.task_type !== "trending_baokuan") {
      return null
    }
    const payload = parseResultPayload(task.result_data)
    const rawCollectionId = payload?.collection_id ?? payload?.collectionId
    if (!rawCollectionId) {
      return null
    }
    const collectionId =
      typeof rawCollectionId === "string" ? rawCollectionId : rawCollectionId != null ? String(rawCollectionId) : null
    if (!collectionId) {
      return null
    }
    const imageUrls = getTaskImageUrls(task)
    if (imageUrls.length === 0) {
      return null
    }
    const batchIdRaw = payload?.batch_id ?? payload?.batchId
    const imageCountRaw = payload?.image_count ?? payload?.imageCount
    const trendNameRaw = payload?.trend_name ?? payload?.trendName
    const fallbackIdParts = [collectionId, typeof batchIdRaw === "string" ? batchIdRaw : "", task.created_at ?? ""]
    const fallbackId = fallbackIdParts.filter(Boolean).join("-")
    const tenantTaskId =
      (typeof task.tenant_task_id === "string" && task.tenant_task_id) ||
      (task.id != null ? String(task.id) : fallbackId || imageUrls[0])

    return {
      tenantTaskId,
      collectionId,
      batchId: batchIdRaw ? String(batchIdRaw) : undefined,
      imageCount:
        typeof imageCountRaw === "number"
          ? imageCountRaw
          : Array.isArray(task.image_urls)
            ? task.image_urls.length
            : imageUrls.length,
      imageUrls,
      createdAt: typeof task.created_at === "string" ? task.created_at : undefined,
      trendName: typeof trendNameRaw === "string" ? trendNameRaw : undefined,
    }
  }

  type TrendingGenerationRequest = {
    endpoint: string
    payload: Record<string, unknown>
    collection: Collection
    packageTrendName?: string
    previewImages?: string[]
  }

  const triggerTrendingGeneration = async ({
    endpoint,
    payload,
    collection,
    packageTrendName,
    previewImages,
  }: TrendingGenerationRequest) => {
    const token = (typeof window !== "undefined" && (localStorage.getItem("token") || localStorage.getItem("auth_token"))) || null
    if (!token) {
      setGenerateError(copy.errors.loginRequired)
      return
    }

    setIsGenerating(true)
    setGenerateError(null)
    setGeneratePreviewUrls([])
    setGenerateTaskId(null)

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.detail === "string" && data.detail.length > 0 ? data.detail : copy.errors.generic)
      }

      const storedEntries = Array.isArray(data?.images) ? data.images : []
      const generatedUrls = previewImages && previewImages.length > 0
        ? previewImages
        : storedEntries
            .map((entry) => buildStaticImageUrl(entry))
            .filter((url): url is string => Boolean(url))

      setGeneratePreviewUrls(generatedUrls.slice(0, 4))
      setGenerateTaskId(typeof data?.tenantTaskId === "string" ? data.tenantTaskId : null)

      if (storedEntries.length > 0) {
        const imageUrls = storedEntries
          .map((entry) => buildStaticImageUrl(entry))
          .filter((url): url is string => Boolean(url))
        if (imageUrls.length > 0) {
          const newPackage: BaokuanPackage = {
            tenantTaskId: typeof data?.tenantTaskId === "string" ? data.tenantTaskId : `${collection.id}-${Date.now()}`,
            collectionId: collection.id,
            batchId: typeof data?.batchId === "string" ? data.batchId : undefined,
            imageCount: imageUrls.length,
            imageUrls,
            createdAt: new Date().toISOString(),
            trendName: packageTrendName ?? collection.query,
          }
          setBaokuanHistory((previous) => {
            const filtered = previous.filter((entry) => entry.tenantTaskId !== newPackage.tenantTaskId)
            return [newPackage, ...filtered]
          })
        }
      }
    } catch (error) {
      console.error("Failed to generate capsule", error)
      setGenerateError(error instanceof Error && typeof error.message === "string" && error.message.length > 0 ? error.message : copy.errors.generic)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateBaokuan = async (collection: Collection | null) => {
    if (!collection || isGenerating) return
    const trendDetail = collection.trends.map((trend) => `- ${trend.name}: ${trend.description}`).join("\n")
    await triggerTrendingGeneration({
      endpoint: "/api/trending/baokuan",
      payload: {
        collection_id: collection.id,
        trend_id: null,
        trend_name: collection.query,
        trend_summary: collection.summary,
        trend_description: trendDetail,
      },
      collection,
      packageTrendName: collection.query,
    })
  }

  const handleGenerateTongkuan = async (collection: Collection | null, trend: Trend) => {
    if (!collection || isGenerating) return
    setIsGenerating(true)
    const referenceImageDataUrl = await loadTrendImageDataUrl(trend)
    if (!referenceImageDataUrl) {
      setGenerateError(copy.errors.referenceImage)
      setIsGenerating(false)
      return
    }
    await triggerTrendingGeneration({
      endpoint: "/api/trending/tongkuan",
      payload: {
        collection_id: collection.id,
        trend_id: trend.id,
        trend_name: trend.name,
        trend_summary: trend.description,
        trend_description: trend.description,
        reference_image_data_url: referenceImageDataUrl,
      },
      collection,
      packageTrendName: trend.name,
    })
  }

  const formatReportDate = (value?: string) => {
    if (!value) return copy.misc.reportDateFallback
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString(localeCode, { year: "numeric", month: "short", day: "numeric" })
  }

  const formatPackageTimestamp = (value?: string) => {
    if (!value) return copy.misc.unknownTime
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      return value
    }
    return parsed.toLocaleString(localeCode, { hour12: false })
  }

  const showReportSection = reportLoading || reportCards.length > 0

  const activeCollectionPackages = activeCollection ? packagesByCollection[activeCollection.id] ?? [] : []
  const hasActiveCollectionHistory = activeCollectionPackages.length > 0
  const packageModalList = packageModalCollectionId ? packagesByCollection[packageModalCollectionId] ?? [] : []
  const activePackage =
    packageModalList[packageModalActiveIndex] ?? packageModalList[0] ?? (packageModalList.length > 0 ? packageModalList[0] : null)
  const packageModalCollection =
    packageModalCollectionId && packageModalCollectionId.length > 0
      ? history.find((item) => item.id === packageModalCollectionId)
      : undefined

  const markdownComponents: Components = {
    h1: ({ children }) => <h1 className="text-3xl font-serif font-semibold text-white mb-4">{children}</h1>,
    h2: ({ children }) => <h2 className="text-2xl font-serif text-emerald-300 mt-6 mb-2">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xl font-serif text-white mt-5 mb-2">{children}</h3>,
    p: ({ children }) => <p className="text-sm text-gray-200 leading-relaxed mb-3">{children}</p>,
    ul: ({ children }) => <ul className="list-disc list-outside pl-5 space-y-1 text-sm text-gray-200">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-outside pl-5 space-y-1 text-sm text-gray-200">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
    em: ({ children }) => <em className="text-gray-300">{children}</em>,
    hr: () => <hr className="my-6 border-white/10" />,
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] bg-[#050505] text-white">
      <aside className="hidden w-64 flex-shrink-0 border-r border-white/10 bg-black p-8 md:block">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400 mb-8 border-b border-white/10 pb-4">
          {copy.sidebar.title}
        </h2>
        <div className="space-y-10">
          <div>
            <button
              onClick={() => setSelectedFilter("all")}
              className={`text-sm font-bold w-full text-left transition-all duration-300 flex items-center group ${
                selectedFilter === "all" ? "text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-3 transition-all ${
                  selectedFilter === "all"
                    ? "bg-emerald-400 scale-125"
                    : "bg-transparent border border-gray-600 group-hover:border-gray-400"
                }`}
              ></span>
              {copy.sidebar.all}
            </button>
          </div>

          {filterGroups.map((group) => (
            <div key={group.key}>
              <h3 className="text-sm font-bold text-white mb-4">{group.title}</h3>
              <ul className="space-y-3">
                {group.options.map((option) => (
                  <li key={option.key}>
                    <button
                      onClick={() => setSelectedFilter(option.key)}
                      className={`text-xs flex items-center group w-full text-left transition-all duration-300 ${
                        selectedFilter === option.key ? "text-white font-bold pl-2" : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full mr-3 transition-all ${
                          selectedFilter === option.key
                            ? "bg-emerald-400 scale-125"
                            : "bg-gray-700 group-hover:bg-gray-500"
                        }`}
                      ></span>
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-grow p-6 md:p-10 bg-[#050505]">
        <div className="flex justify-between items-end mb-10 border-b border-white/10 pb-6">
          <div>
            <h1 className="font-serif text-3xl md:text-4xl text-white mb-2">{copy.headings.page}</h1>
            <p className="text-xs text-gray-500 uppercase tracking-[0.25em]">{selectedFilterLabel}</p>
          </div>
        </div>

        {showReportSection && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">{copy.headings.curatedBadge}</p>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
              {reportLoading
                ? Array.from({ length: 3 }).map((_, idx) => (
                    <div
                      key={`skeleton-${idx}`}
                      className="min-w-[240px] rounded-2xl border border-white/5 bg-white/5/20 p-4 animate-pulse"
                    >
                      <div className="h-3 w-20 bg-white/10 rounded mb-3"></div>
                      <div className="h-4 w-3/4 bg-white/10 rounded mb-2"></div>
                      <div className="h-4 w-2/3 bg-white/10 rounded"></div>
                    </div>
                  ))
                : reportCards.slice(0, 4).map((report) => (
                    <button
                      key={report.id}
                      onClick={() => handleReportCardClick(report)}
                      className="min-w-[240px] md:min-w-[280px] text-left rounded-2xl border border-white/5 bg-gradient-to-br from-white/5 via-transparent to-emerald-400/10 p-5 transition hover:border-emerald-400/40 hover:-translate-y-1"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 mb-2">
                        {formatReportDate(report.generated_at)}
                      </p>
                      <h3 className="font-serif text-lg text-white leading-snug line-clamp-3 min-h-[60px]">{report.headline}</h3>
                      <span className="mt-4 inline-flex items-center text-[10px] font-bold tracking-[0.3em] text-emerald-400">
                        {copy.buttons.viewReport}
                        <svg className="ml-2 h-3 w-3" viewBox="0 0 20 20" fill="none">
                          <path d="M5 10h10M10 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </span>
                    </button>
                  ))}
            </div>
            {reportError && <p className="text-xs text-red-400 mt-3">{reportError}</p>}
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredHistory.map((collection) => {
            const coverImage = collection.trends[0]?.image
            return (
              <div
                key={collection.id}
                className="group cursor-pointer flex flex-col h-full"
                onClick={() => handleCardClick(collection)}
              >
                <div className="aspect-[3/4] w-full overflow-hidden bg-[#111] relative mb-4 border border-white/5 transition-all duration-500 group-hover:border-white/20">
                  {coverImage ? (
                    <Image
                      src={coverImage}
                      alt={collection.query}
                      fill
                      sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 100vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105 opacity-80 group-hover:opacity-100"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-full h-full border border-dashed border-white/10 flex flex-col items-center justify-center group-hover:border-emerald-400/30 transition-colors">
                        <span className="font-serif text-4xl text-white/10 font-bold mb-4">Fasium</span>
                        <p className="font-serif text-lg text-gray-500 italic px-4 leading-tight group-hover:text-white transition-colors">
                          {collection.query}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-emerald-400/20 via-transparent to-transparent opacity-40 group-hover:opacity-80 transition-opacity duration-700 pointer-events-none mix-blend-screen"></div>
                  <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-400/10 rounded-full blur-3xl group-hover:bg-emerald-400/20 transition-colors duration-700"></div>
                  <div className="absolute bottom-4 left-4 right-4 flex justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-y-4 group-hover:translate-y-0">
                    <span className="bg-white text-black text-[10px] font-bold uppercase tracking-widest px-4 py-2 z-10">
                      {copy.buttons.viewDetails}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center text-[9px] text-gray-500 uppercase tracking-widest mb-2 space-x-2">
                    <span className="text-emerald-400">{collection.season}</span>
                    <span className="w-px h-2 bg-gray-700"></span>
                    <span>{collection.category}</span>
                  </div>
                  <h3 className="font-serif text-lg font-medium text-gray-200 leading-tight mb-4 group-hover:text-white transition-colors">
                    {collection.query}
                  </h3>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {activeCollection && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div
            className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-500 ease-in-out ${
              isModalOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={handleCloseModal}
          ></div>
          <div
            className={`relative w-full md:w-4/5 lg:w-3/5 bg-[#0a0a0a] h-full shadow-2xl flex flex-col border-l border-white/10 transition-transform duration-500 ease-in-out transform ${
              isModalOpen ? "translate-x-0" : "translate-x-full"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex-shrink-0 px-10 py-8 border-b border-white/10 flex justify-between items-start z-10 bg-[#0a0a0a]">
              <div>
                <div className="flex items-center space-x-3 mb-3">
                  <span className="px-2 py-1 bg-emerald-400 text-black text-[10px] uppercase tracking-widest font-bold">
                    {activeCollection.season}
                  </span>
                </div>
                <h2 className="font-serif text-4xl text-white mb-4">{activeCollection.query}</h2>
              </div>
              <button onClick={handleCloseModal} className="group p-2 rounded-full hover:bg-white/10 transition-colors">
                <svg
                  className="w-6 h-6 text-gray-500 group-hover:text-white transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-grow overflow-y-auto">
              <div className="p-10 space-y-12">
                <div className="max-w-3xl">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-4">
                    {copy.headings.summary}
                  </h3>
                  <p className="text-base md:text-lg text-gray-300 font-light leading-loose">{activeCollection.summary}</p>
                </div>

                <div>
                  {hasActiveCollectionHistory && (
                    <div className="mb-4 flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleOpenPackageModal(activeCollection.id)}
                        className="relative flex h-16 w-16 items-center justify-center rounded-xl border border-emerald-400/70 bg-emerald-400/15 text-white transition hover:bg-emerald-400 hover:text-black"
                        aria-label={copy.buttons.viewHistory}
                      >
                        <FolderOpen className="h-6 w-6" />
                        <span className="absolute -bottom-1.5 -right-1.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold text-black">
                          {activeCollectionPackages.length}
                        </span>
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleGenerateBaokuan(activeCollection)}
                      disabled={isGenerating || !activeCollection}
                      className={`flex-1 py-5 bg-emerald-400 transition-colors text-black flex items-center justify-center group relative overflow-hidden ${
                        isGenerating || !activeCollection ? "opacity-60 cursor-not-allowed" : "hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center space-x-3 relative z-10">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                          />
                        </svg>
                        <span className="font-serif text-xl font-bold uppercase tracking-widest italic">
                          {isGenerating ? copy.buttons.generatingCapsule : copy.buttons.generateCapsule}
                        </span>
                      </div>
                    </button>
                    {baokuanHistoryLoading && (
                      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
                        <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                      </span>
                    )}
                  </div>
                  {baokuanHistoryError && (
                    <p className="mt-3 text-xs text-red-400">{baokuanHistoryError}</p>
                  )}
                  {generateError && <p className="mt-3 text-sm text-red-400">{generateError}</p>}
                  {generatePreviewUrls.length > 0 && (
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-emerald-400">
                        <span>{copy.headings.latestPreview}</span>
                        {generateTaskId && (
                          <span className="text-[10px] text-gray-400 tracking-[0.2em]">
                            {copy.labels.previewTaskIdPrefix}
                            {generateTaskId}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {generatePreviewUrls.map((url, index) => (
                          <button
                            key={`${url}-${index}`}
                            type="button"
                            className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40 transition hover:border-emerald-300/70"
                            onClick={() => setPackagePreviewImage(url)}
                            aria-label={copy.labels.previewImageAria.replace("{index}", String(index + 1))}
                          >
                            <img
                              src={url}
                              alt={copy.labels.previewImageAlt.replace("{index}", String(index + 1))}
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                            />
                            <span className="pointer-events-none absolute inset-0 bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"></span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] uppercase tracking-[0.3em] text-gray-500">{copy.headings.previewHint}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {activeCollection.trends.map((trend) => (
                      <div key={trend.id} className="flex flex-col space-y-3">
                        <div className="group/image aspect-[3/4] bg-[#111] relative overflow-hidden border border-white/5">
                          <Image
                            src={trend.image}
                            alt={trend.name}
                            fill
                            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
                            className="object-cover transition-transform duration-500 group-hover/image:scale-105"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover/image:bg-black/50 group-hover/image:opacity-100">
                            <button
                              type="button"
                              onClick={() => void handleGenerateTongkuan(activeCollection, trend)}
                              disabled={isGenerating || !activeCollection}
                              className={`text-xs tracking-[0.3em] px-4 py-2 uppercase font-semibold ${
                                isGenerating || !activeCollection
                                  ? "bg-white/40 text-black/60 cursor-not-allowed"
                                  : "bg-white/90 text-black hover:bg-white"
                              }`}
                            >
                              {isGenerating ? copy.buttons.generatingMatch : copy.buttons.generateMatch}
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{trend.name}</p>
                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">{trend.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeReport && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
          <div
            className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-500 ${
              isReportModalOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={handleCloseReportModal}
          ></div>
          <div
            className={`relative w-full max-w-3xl bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl p-8 md:p-10 transition-all duration-500 ${
              isReportModalOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-400 mb-2">{copy.headings.reportModal}</p>
                <h2 className="font-serif text-3xl text-white mb-2">{activeReport.headline}</h2>
                <p className="text-xs text-gray-500">{formatReportDate(activeReport.generated_at)}</p>
              </div>
              <button
                onClick={handleCloseReportModal}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto pr-2 report-markdown space-y-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {activeReport.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {packageModalCollectionId && packageModalList.length > 0 && activePackage && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={handleClosePackageModal}></div>
          <div
            className="relative w-full max-w-5xl rounded-2xl border border-white/10 bg-[#050505] p-6 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
              <div className="mb-6 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-emerald-400">{copy.headings.history}</p>
                  <h2 className="font-serif text-3xl text-white mt-1">
                    {packageModalCollection?.query || copy.headings.historyFallback}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {formatPackageTimestamp(activePackage.createdAt)} ·{" "}
                    {copy.labels.historyImageCount.replace("{count}", String(activePackage.imageCount))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClosePackageModal}
                  className="self-end rounded-full border border-white/10 p-2 text-gray-400 transition hover:text-white"
                  aria-label={copy.buttons.closeHistory}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                </button>
            </div>

              <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
                {packageModalList.map((pkg, index) => {
                  const isActive = packageModalActiveIndex === index || (!packageModalActiveIndex && index === 0)
                  const label = pkg.batchId
                    ? copy.labels.packageBatch.replace("{id}", pkg.batchId.slice(0, 8))
                    : copy.labels.packageLabel.replace("{index}", String(index + 1))
                  return (
                    <button
                      key={`${pkg.tenantTaskId}-${index}`}
                      type="button"
                      onClick={() => setPackageModalActiveIndex(index)}
                      className={`min-w-[160px] rounded-xl border px-4 py-3 text-left transition ${
                        isActive ? "border-emerald-400/60 bg-emerald-400/10" : "border-white/10 bg-white/5 hover:border-white/30"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-[0.3em] text-gray-400">{label}</p>
                      <p className="text-xs text-gray-300 mt-1">{formatPackageTimestamp(pkg.createdAt)}</p>
                    </button>
                  )
                })}
              </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {activePackage.imageUrls.map((url, index) => (
                <button
                  key={`${activePackage.tenantTaskId}-${index}`}
                  type="button"
                  className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/50 text-left transition hover:border-emerald-400/60"
                  onClick={() => setPackagePreviewImage(url)}
                >
                  <div className="aspect-[3/4] w-full overflow-hidden bg-black/40">
                    <img
                      src={url}
                      alt={copy.labels.historyImageAlt.replace("{index}", String(index + 1))}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-300">
                    <span>{copy.labels.imageLabel.replace("{index}", String(index + 1))}</span>
                    <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">{copy.labels.view}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {packagePreviewImage && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            onClick={() => setPackagePreviewImage(null)}
            role="presentation"
          ></div>
          <div
            className="relative w-full max-w-4xl rounded-2xl border border-white/10 bg-black/70 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPackagePreviewImage(null)}
              className="absolute right-4 top-4 rounded-full border border-white/20 p-2 text-gray-300 transition hover:text-white"
              aria-label={copy.buttons.closePreview}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
            <div className="max-h-[80vh] overflow-hidden rounded-xl border border-white/10 bg-black/60">
              <img
                src={packagePreviewImage}
                alt={copy.labels.historyPreviewAlt}
                className={`h-full w-full object-contain transition-opacity duration-300 ${
                  isPreviewFadingIn ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TrendingPage() {
  const { locale, messages } = useI18n()
  const history = useMemo(() => resolveCollections(locale), [locale])

  return (
    <div className="min-h-screen flex flex-col bg-[#050505] font-sans text-white selection:bg-emerald-400 selection:text-black">
      <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/10 h-16 flex items-center justify-end px-6 md:px-10">
        <div className="flex items-center space-x-6">
          <span className="hidden md:inline text-xs font-bold uppercase tracking-[0.2em] text-gray-500">
            {messages.trending.navTagline}
          </span>
          <div className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center text-xs font-serif italic border border-white/20">
            FA
          </div>
        </div>
      </nav>
      <main className="flex-grow">
        <TrendDashboard history={history} />
      </main>
    </div>
  )
}
