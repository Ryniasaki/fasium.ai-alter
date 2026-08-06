"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUpRight,
  Wand2,
  Grid3X3,
  Layers,
  Shuffle,
  Ruler,
  Grid,
  Scan,
  Eraser,
  PenTool,
  Shirt,
  Infinity,
  FileSpreadsheet,
  Hammer,
  Video,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { ToolApp, toolApps, toolCategories } from "@/lib/tools-catalog"
import type { Locale, Messages } from "@/lib/i18n/translations"
import { useI18n } from "@/contexts/i18n-context"

const ALL_CATEGORY = toolCategories[0]

type ArtworkStyle = {
  backgroundImage: string
  overlayImage?: string
  overlaySize?: string
  overlayOpacity?: number
}

const DEFAULT_ARTWORK: ArtworkStyle = {
  backgroundImage:
    "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15), transparent 55%), linear-gradient(135deg, rgba(15,23,42,0.9), rgba(15,23,42,0.5))",
  overlayImage:
    "linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
  overlaySize: "120px 120px",
  overlayOpacity: 0.25,
}

const TOOL_ARTWORK_MAP: Record<string, ArtworkStyle> = {
  "Targeted Redesign": {
    backgroundImage:
      "radial-gradient(circle at 20% 25%, rgba(16,185,129,0.35), transparent 40%), radial-gradient(circle at 80% 10%, rgba(74,222,128,0.25), transparent 55%), linear-gradient(140deg, rgba(6,17,25,0.95), rgba(5,32,34,0.9))",
    overlayImage:
      "linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
    overlaySize: "140px 140px",
    overlayOpacity: 0.25,
  },
  "Pattern Extraction": {
    backgroundImage:
      "radial-gradient(circle at 15% 85%, rgba(125,211,252,0.55), transparent 45%), radial-gradient(circle at 80% 20%, rgba(59,130,246,0.45), transparent 50%), linear-gradient(160deg, rgba(8,47,73,0.95), rgba(15,118,110,0.55))",
    overlayImage:
      "linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
    overlaySize: "90px 90px",
    overlayOpacity: 0.35,
  },
  "Pattern Application": {
    backgroundImage:
      "radial-gradient(circle at 30% 30%, rgba(45,212,191,0.35), transparent 45%), radial-gradient(circle at 75% 70%, rgba(13,148,136,0.35), transparent 55%), linear-gradient(150deg, rgba(6,17,25,0.95), rgba(5,30,38,0.85))",
    overlayImage:
      "repeating-linear-gradient(60deg, rgba(94,234,212,0.2) 0 14px, transparent 14px 28px), linear-gradient(0deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
    overlaySize: "90px 90px",
    overlayOpacity: 0.35,
  },
  Variants: {
    backgroundImage:
      "radial-gradient(circle at 15% 25%, rgba(45,212,191,0.25), transparent 40%), radial-gradient(circle at 85% 70%, rgba(16,185,129,0.35), transparent 50%), linear-gradient(135deg, rgba(7,23,32,0.95), rgba(5,24,23,0.9))",
    overlayImage:
      "linear-gradient(135deg, rgba(255,255,255,0.08) 20%, transparent 20%, transparent 50%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.08) 70%, transparent 70%, transparent)",
    overlaySize: "120px 120px",
    overlayOpacity: 0.3,
  },
  "Stripe Extract": {
    backgroundImage:
      "repeating-linear-gradient(120deg, rgba(251,191,36,0.35) 0 30px, rgba(249,115,22,0.35) 30px 60px), linear-gradient(135deg, rgba(120,53,15,0.85), rgba(180,83,9,0.6))",
    overlayImage: "linear-gradient(90deg, rgba(255,255,255,0.2) 0, transparent 55%)",
    overlaySize: "300px 300px",
    overlayOpacity: 0.25,
  },
  "Plaid Extract": {
    backgroundImage:
      "radial-gradient(circle at 30% 20%, rgba(59,130,246,0.3), transparent 50%), radial-gradient(circle at 70% 65%, rgba(37,99,235,0.3), transparent 55%), linear-gradient(150deg, rgba(11,20,35,0.95), rgba(15,32,65,0.85))",
    overlayImage:
      "linear-gradient(0deg, rgba(148,163,184,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.25) 1px, transparent 1px), linear-gradient(45deg, transparent 45%, rgba(255,255,255,0.03) 45% 55%, transparent 55%)",
    overlaySize: "60px 60px",
    overlayOpacity: 0.35,
  },
  "High Resolution": {
    backgroundImage:
      "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5), transparent 45%), radial-gradient(circle at 80% 40%, rgba(148,163,184,0.35), transparent 55%), linear-gradient(145deg, rgba(30,41,59,0.95), rgba(15,23,42,0.6))",
    overlayImage:
      "linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
    overlaySize: "60px 60px",
    overlayOpacity: 0.2,
  },
  "Background Removal": {
    backgroundImage:
      "radial-gradient(circle at 25% 30%, rgba(254,240,138,0.7), transparent 45%), radial-gradient(circle at 80% 80%, rgba(253,186,116,0.45), transparent 55%), linear-gradient(150deg, rgba(120,53,15,0.9), rgba(180,83,9,0.55))",
    overlayImage:
      "linear-gradient(135deg, rgba(255,255,255,0.15) 15%, transparent 15%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 65%, transparent 65%, transparent)",
    overlaySize: "150px 150px",
    overlayOpacity: 0.25,
  },
  "SVG Vectorization": {
    backgroundImage:
      "radial-gradient(circle at 10% 80%, rgba(45,212,191,0.55), transparent 50%), radial-gradient(circle at 85% 20%, rgba(6,182,212,0.55), transparent 55%), linear-gradient(140deg, rgba(1,65,75,0.95), rgba(6,95,70,0.6))",
    overlayImage:
      "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
    overlaySize: "70px 70px",
    overlayOpacity: 0.25,
  },
  "Virtual Try-On": {
    backgroundImage:
      "radial-gradient(circle at 20% 25%, rgba(52,211,153,0.35), transparent 45%), radial-gradient(circle at 75% 65%, rgba(34,197,94,0.25), transparent 55%), linear-gradient(145deg, rgba(5,18,28,0.95), rgba(6,31,26,0.85))",
    overlayImage:
      "linear-gradient(120deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0) 45%), radial-gradient(circle at 70% 10%, rgba(255,255,255,0.05), transparent 45%)",
    overlaySize: "260px 260px",
    overlayOpacity: 0.3,
  },
  "Seamless Patterns": {
    backgroundImage:
      "radial-gradient(circle at 25% 30%, rgba(45,212,191,0.2), transparent 45%), radial-gradient(circle at 80% 70%, rgba(16,185,129,0.25), transparent 55%), linear-gradient(150deg, rgba(5,17,27,0.95), rgba(6,24,31,0.85))",
    overlayImage:
      "radial-gradient(circle, rgba(94,234,212,0.15) 2px, transparent 2px), radial-gradient(circle, rgba(94,234,212,0.05) 4px, transparent 4px)",
    overlaySize: "60px 60px",
    overlayOpacity: 0.35,
  },
  "Sheet F8": {
    backgroundImage:
      "radial-gradient(circle at 20% 80%, rgba(45,212,191,0.55), transparent 50%), radial-gradient(circle at 80% 15%, rgba(59,130,246,0.5), transparent 55%), linear-gradient(135deg, rgba(8,51,68,0.95), rgba(15,118,110,0.6))",
    overlayImage:
      "linear-gradient(0deg, rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px)",
    overlaySize: "100px 100px",
    overlayOpacity: 0.25,
  },
  "CAD Toolkit": {
    backgroundImage:
      "radial-gradient(circle at 25% 30%, rgba(148,163,184,0.35), transparent 45%), radial-gradient(circle at 75% 70%, rgba(100,116,139,0.25), transparent 55%), linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,41,59,0.6))",
    overlayImage:
      "linear-gradient(120deg, rgba(255,255,255,0.12) 20%, transparent 20%, transparent 50%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.12) 70%, transparent 70%, transparent)",
    overlaySize: "180px 180px",
    overlayOpacity: 0.2,
  },
  "Video Generation": {
    backgroundImage:
      "radial-gradient(circle at 20% 25%, rgba(129,140,248,0.55), transparent 45%), radial-gradient(circle at 80% 70%, rgba(56,189,248,0.45), transparent 55%), linear-gradient(140deg, rgba(15,23,42,0.95), rgba(30,27,75,0.65))",
    overlayImage:
      "linear-gradient(150deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 45%), radial-gradient(circle at 70% 10%, rgba(236,72,153,0.12), transparent 45%)",
    overlaySize: "360px 360px",
    overlayOpacity: 0.35,
  },
}

const TOOL_ICON_MAP: Record<string, LucideIcon | undefined> = {
  "Targeted Redesign": Wand2,
  "Pattern Extraction": Grid3X3,
  "Pattern Application": Layers,
  Variants: Shuffle,
  "Stripe Extract": Ruler,
  "Plaid Extract": Grid,
  "High Resolution": Scan,
  "Background Removal": Eraser,
  "SVG Vectorization": PenTool,
  "Virtual Try-On": Shirt,
  "Seamless Patterns": Infinity,
  "Sheet F8": FileSpreadsheet,
  "CAD Toolkit": Hammer,
  "Video Generation": Video,
}

const formatTemplate = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  )

type ToolsMessages = Messages["tools"]
type ToolDescriptionMap = ToolsMessages["toolDescriptions"]

type GroupedTools = Record<string, ToolApp[]>

export default function ToolsPage() {
  const router = useRouter()
  const { locale, messages } = useI18n()
  const copy = messages.tools
  const toolDescriptions = copy.toolDescriptions
  const [activeFilter, setActiveFilter] = useState<string>(ALL_CATEGORY)
  const [searchQuery, setSearchQuery] = useState("")

  const formatCategoryLabel = (category: string) => copy.categories[category] ?? category
  const formatToolCountLabel = (count: number) => {
    const template = count === 1 ? copy.toolCount.singular : copy.toolCount.plural
    return formatTemplate(template, { count })
  }

  const filteredTools = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return toolApps.filter((tool) => {
      const matchesCategory = activeFilter === ALL_CATEGORY || tool.category === activeFilter
      if (!matchesCategory) {
        return false
      }
      if (!query) {
        return true
      }
      const haystack = `${tool.name} ${tool.displayName} ${tool.description} ${tool.category} ${tool.focus}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [activeFilter, searchQuery])

  const groupedTools = useMemo<GroupedTools>(() => {
    const queryActive = searchQuery.trim().length > 0
    if (activeFilter !== ALL_CATEGORY || queryActive) {
      if (filteredTools.length === 0) {
        return {}
      }
      return { [copy.searchResultsLabel]: filteredTools }
    }

    const groups: GroupedTools = {}
    toolCategories.slice(1).forEach((category) => {
      const items = filteredTools.filter((tool) => tool.category === category)
      if (items.length) {
        groups[category] = items
      }
    })
    return groups
  }, [activeFilter, filteredTools, searchQuery, copy.searchResultsLabel])

  const handleNavigate = (tool: ToolApp) => {
    if (tool.status === "暂未开放") {
      return
    }
    router.push(tool.href)
  }

  return (
    <div className="min-h-screen bg-[#050406] text-white">
      <header className="fixed left-0 right-0 top-0 z-20 flex h-20 items-center justify-between border-b border-white/5 bg-[#050406]/95 px-6 lg:px-12">
        <div className="flex items-center gap-2">
          <p className="text-2xl font-serif tracking-tight text-white">
            {copy.header.brand}
            <span className="font-sans text-lg font-bold tracking-normal text-[#e8fee4]">
              {copy.header.suffix}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-6 text-[10px] uppercase tracking-[0.25em] text-white/60">
          <span className="hidden md:inline-block font-bold tracking-[0.2em] text-gray-400">
            {copy.header.tagline}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-xs font-serif italic text-[#c4fcef]">
            {copy.header.initials}
          </span>
        </div>
      </header>

      <div className="pt-20 lg:flex">
        <main className="flex-1 px-4 py-10 md:px-10">
          <div className="mx-auto max-w-[1500px] animate-in fade-in">
            <div className="mb-10 border-b border-white/10 pb-8" />

            {Object.keys(groupedTools).length === 0 ? (
              <EmptyState copy={copy.emptyState} />
            ) : (
              <div className="space-y-20 pb-24">
                {Object.entries(groupedTools).map(([category, tools]) => (
                  <section key={category} className="space-y-8">
                        {activeFilter === ALL_CATEGORY && searchQuery.trim().length === 0 ? (
                          <div className="flex items-center justify-between">
                            <h2 className="text-xl font-serif text-white">{formatCategoryLabel(category)}</h2>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <h2 className="text-xl font-serif text-white">{formatCategoryLabel(category)}</h2>
                            <span className="text-xs text-white/50">{formatToolCountLabel(tools.length)}</span>
                          </div>
                        )}

                    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {tools.map((tool, index) => (
                        <ToolCard
                          key={tool.name}
                          tool={tool}
                          index={index}
                          onSelect={handleNavigate}
                          labelResolver={formatCategoryLabel}
                          locale={locale}
                          toolDescriptions={toolDescriptions}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function ToolCard({
  tool,
  index,
  onSelect,
  labelResolver,
  locale,
  toolDescriptions,
}: {
  tool: ToolApp
  index: number
  onSelect: (tool: ToolApp) => void
  labelResolver: (category: string) => string
  locale: Locale
  toolDescriptions: ToolDescriptionMap
}) {
  const isDisabled = tool.status === "暂未开放"
  const artwork = TOOL_ARTWORK_MAP[tool.name] ?? DEFAULT_ARTWORK
  const IconComponent = TOOL_ICON_MAP[tool.name]
  const titleText = locale === "zh" ? tool.displayName ?? tool.name : tool.name
  const categoryLabel = labelResolver(tool.category)
  const descriptionText = toolDescriptions?.[tool.name] ?? tool.description

  return (
    <button
      type="button"
      onClick={() => onSelect(tool)}
      disabled={isDisabled}
      className={`group relative aspect-square w-full overflow-hidden rounded-[28px] border border-white/10 text-left shadow-[0_20px_70px_rgba(3,6,32,0.35)] transition hover:border-white/30 hover:shadow-[0_30px_90px_rgba(3,6,32,0.55)] ${
        isDisabled ? "cursor-not-allowed opacity-70 grayscale" : ""
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: artwork.backgroundImage,
          }}
        />
        {artwork.overlayImage && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: artwork.overlayImage,
              backgroundSize: artwork.overlaySize,
              opacity: artwork.overlayOpacity ?? 0.25,
            }}
          />
        )}
        {IconComponent && (
          <div className="absolute left-6 top-6 flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-black/25 text-white shadow-lg backdrop-blur">
            <IconComponent className="h-5 w-5 text-white" />
          </div>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pb-24 pt-10">
          <p className="text-3xl font-serif text-white">{titleText}</p>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-black/60 px-6 py-5 backdrop-blur">
          <p className="text-[10px] uppercase tracking-[0.5em] text-white/40">{categoryLabel}</p>
          <p className="text-sm text-white/65 line-clamp-2">{descriptionText}</p>
        </div>
      </div>
    </button>
  )
}

type EmptyStateProps = {
  copy: ToolsMessages["emptyState"]
}

function EmptyState({ copy }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] py-32 text-center">
      <p className="text-2xl font-serif text-white/80">{copy.title}</p>
      <p className="mt-3 text-sm text-white/50">{copy.description}</p>
    </div>
  )
}
