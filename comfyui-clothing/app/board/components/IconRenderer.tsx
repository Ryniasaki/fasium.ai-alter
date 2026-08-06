"use client"

import {
  Wand2,
  Infinity as InfinityIcon,
  Maximize,
  Eraser,
  PenTool,
  LayoutGrid,
  Download,
  Ruler,
  History,
  Settings,
  Search,
  Zap,
  Box,
  User,
  ChevronRight,
  ChevronDown,
  Plus,
  List,
  Grid,
  MousePointer2,
  Hand,
  Images,
  ImagePlus,
  Pencil,
  X,
  Archive,
  Loader2,
  Scissors,
  Spline as BezierCurve,
  Shield,
  Play,
  Video,
} from "lucide-react"

const icons = {
  Wand2,
  InfinityIcon,
  Maximize,
  Eraser,
  PenTool,
  LayoutGrid,
  Download,
  Ruler,
  History,
  Settings,
  Search,
  Zap,
  Box,
  User,
  ChevronRight,
  ChevronDown,
  Plus,
  List,
  Grid,
  MousePointer2,
  Hand,
  Images,
  ImagePlus,
  Pencil,
  X,
  Archive,
  Loader2,
  Scissors,
  BezierCurve,
  Shield,
  Play,
  Video,
}

interface IconRendererProps {
  name: string
  className?: string
  size?: number
}

export function IconRenderer({ name, className, size = 20 }: IconRendererProps) {
  const IconComponent = icons[name as keyof typeof icons] || Box
  return <IconComponent className={className} size={size} />
}
