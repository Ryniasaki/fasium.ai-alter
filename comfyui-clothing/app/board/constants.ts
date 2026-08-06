import type { Category, Task, Tool } from "./types"

export const CATEGORIES: Category[] = [
  { id: "design", title: "设计提案", icon: "Box" },
  { id: "output", title: "展示输出", icon: "LayoutGrid" },
]

export const TOOLS: Tool[] = [
  {
    id: "image-edit",
    name: "改图",
    description: "通用改图工具，最多支持 4 张参考图；在提示词中描述更改。",
    category: "design",
    icon: "Wand2",
    gradient: "bg-gradient-to-br from-blue-400 to-blue-600",
    tag: "设计提案",
    isPopular: true,
  },
  {
    id: "seamless-pattern",
    name: "无缝花型",
    description: "三步生成可重复的无缝花型用于印花。",
    category: "design",
    icon: "InfinityIcon",
    gradient: "bg-gradient-to-br from-slate-700 to-[#1e293b]",
    tag: "设计提案",
  },
  {
    id: "hd-upscale",
    name: "高清增强",
    description: "通过 AI 算法将模糊图片修复为超清，保留细节纹理。",
    category: "output",
    icon: "Maximize",
    gradient: "bg-gradient-to-br from-indigo-400 to-indigo-600",
    tag: "展示输出",
  },
  {
    id: "svg-vector",
    name: "矢量化",
    description: "将位图转为可编辑的 SVG 矢量图。",
    category: "output",
    icon: "BezierCurve",
    gradient: "bg-gradient-to-br from-emerald-400 to-teal-600",
    tag: "展示输出",
  },
]

export const TASKS: Task[] = [
  {
    id: "1",
    type: "PATTERN EXTRACTION",
    date: "2025年12月17日",
    title: "已生成输出",
    status: "completed",
    images: ["https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&q=80&w=800"],
    tags: ["FLORAL", "GREEN"],
  },
]
