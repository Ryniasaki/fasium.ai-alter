"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  LayoutDashboard,
  ListChecks,
  Settings,
  User,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  LogOut,
  MessageSquare,
  Layers,
  Diamond,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { useI18n } from "@/contexts/i18n-context"
import fashionAiLogo from "@/image/icon/fashionai.png"
import { redesignApiClient } from "@/lib/redesign-api-client"
import { TASK_ACTIVITY_EVENT } from "@/lib/task-activity"

const PENDING_STATUSES = new Set(["PENDING", "RUNNING", "PROCESSING", "COMPLETING"])

export function Navigation() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(true)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    "/variants": false,
  })
  const [pendingTaskCount, setPendingTaskCount] = useState<number | null>(null)
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const { user, isAuthenticated, logout } = useAuth()
  const { messages } = useI18n()
  const navCopy = messages.navigation

  const handleLogout = useCallback(() => {
    logout()
    setIsMobileMenuOpen(false)
    router.push("/")
  }, [logout, router])

  // Treat auth pages as full-screen routes without navigation chrome.
  const isAuthPage = pathname === "/" || pathname === "" || pathname.startsWith("/register")

  type NavigationItem = {
    name: string
    href: string
    icon: LucideIcon
    badge?: string
    badgePlacement?: "inline" | "corner"
    children?: NavigationItem[]
    disabled?: boolean
    comingSoonLabel?: string
  }
  type NavigationVariant = "desktop" | "mobile"

  useEffect(() => {
    if (pathname !== "/" && pathname !== "") {
      setIsDesktopCollapsed(false)
    }
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith("/variants") || pathname.startsWith("/extract_stripe")) {
      setExpandedItems((prev) => {
        if (prev["/variants"]) {
          return prev
        }
        return { ...prev, "/variants": true }
      })
    }
  }, [pathname])

  const toggleItemExpansion = useCallback((href: string) => {
    setExpandedItems((prev) => {
      const current = prev[href]
      const nextValue = !(current ?? true)
      return { ...prev, [href]: nextValue }
    })
  }, [])

  const isExpanded = !isDesktopCollapsed

  const fetchPendingTasks = useCallback(async () => {
    if (!isAuthenticated) {
      setPendingTaskCount(null)
      return
    }

    try {
      const tasks = await redesignApiClient.getTaskHistory(1, undefined, 10)
      const activeCount = tasks.reduce((count, task) => {
        if (task?.status && PENDING_STATUSES.has(task.status.toUpperCase())) {
          return count + 1
        }
        return count
      }, 0)

      setPendingTaskCount(activeCount)
    } catch (error) {
      console.error("Failed to load pending tasks", error)
      setPendingTaskCount(null)
    }
  }, [isAuthenticated])

  useEffect(() => {
    fetchPendingTasks()
  }, [fetchPendingTasks])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleTaskActivity = () => {
      void fetchPendingTasks()
    }

    window.addEventListener(TASK_ACTIVITY_EVENT, handleTaskActivity)
    return () => window.removeEventListener(TASK_ACTIVITY_EVENT, handleTaskActivity)
  }, [fetchPendingTasks])

  const shouldShowTaskBadge = pendingTaskCount !== null && pendingTaskCount > 0
  const isAdmin = user?.group === 1000
  const desktopNavWidth = isExpanded ? 256 : 80

  useEffect(() => {
    if (typeof document === "undefined") return

    const nextOffset = isAuthPage ? "0px" : `${desktopNavWidth}px`
    const nextBoardSafeRight = "0px"

    document.documentElement.style.setProperty("--app-nav-offset", nextOffset)
    document.documentElement.style.setProperty("--board-floating-safe-right", nextBoardSafeRight)

    return () => {
      document.documentElement.style.removeProperty("--app-nav-offset")
      document.documentElement.style.removeProperty("--board-floating-safe-right")
    }
  }, [desktopNavWidth, isDesktopCollapsed, isAuthPage, pathname])

  const navigationItems: NavigationItem[] = [
    ...(user?.role === "manager" && user?.group !== 1000
      ? [
          {
            name: navCopy.items.dashboard,
            href: "/dashboard",
            icon: LayoutDashboard,
          } satisfies NavigationItem,
        ]
      : []),
    {
      name: navCopy.items.tasksRecord,
      href: "/tasks-record",
      icon: ListChecks,
      badge: shouldShowTaskBadge ? String(pendingTaskCount) : undefined,
      badgePlacement: "corner",
    },
    {
      name: navCopy.items.board,
      href: "/board",
      icon: Layers,
    },
    {
      name: navCopy.items.feedback,
      href: "/feedback",
      icon: MessageSquare,
    },
  ]

  if (isAdmin) {
    navigationItems.push({
      name: navCopy.items.admin,
      href: "/admin",
      icon: User,
    })
  }

  const isActive = (href: string) => pathname === href
  const isBoardPage = pathname === "/board"

  const getVariantConfig = (variant: NavigationVariant, depth: number) => {
    const isNested = depth >= 2
    return {
      paddingY: isNested ? "py-3" : "py-4",
      indentClass: depth >= 1 ? "pl-4" : "",
      iconSize: isNested ? "size-4" : "size-5",
      textClass: "font-medium text-sm truncate",
      activeIndicatorId: variant === "desktop" ? "desktop-active-indicator" : "mobile-active-indicator",
    }
  }

  const renderNavigationItems = (items: NavigationItem[], variant: NavigationVariant, depth = 0) =>
    items.map((item) => {
      const isItemActive = isActive(item.href)
      const isItemDisabled = Boolean(item.disabled)
      const isChildrenExpanded = item.children ? expandedItems[item.href] ?? true : false
      const config = getVariantConfig(variant, depth)
      const shouldShowLabels = variant === "mobile" || isExpanded
      const shouldRenderChildren = variant === "desktop" ? isExpanded && isChildrenExpanded : isChildrenExpanded

      return (
        <div key={item.href} className={`space-y-1 ${config.indentClass}`}>
          <div
            className={`relative overflow-hidden flex items-center gap-3 px-3 ${config.paddingY} rounded-lg transition-colors ${
              isItemDisabled
                ? "cursor-not-allowed text-muted-foreground/70 hover:bg-muted/40"
                : isItemActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            onMouseEnter={() => setHoveredItem(item.href)}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {!isItemDisabled && isItemActive && (
              <motion.span
                layoutId={config.activeIndicatorId}
                className="pointer-events-none absolute inset-0 rounded-lg bg-muted/70 ring-1 ring-border"
                transition={{ type: "spring", stiffness: 260, damping: 28 }}
              />
            )}
            <Link
              href={item.href}
              onClick={(event) => {
                if (isItemDisabled) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (isBoardPage && item.href !== "/board" && typeof window !== "undefined") {
                  event.preventDefault()
                  event.stopPropagation()
                  const scopedWindow = window as typeof window & {
                    __fasiumBoardNavigationGuard?: (targetUrl: string) => boolean | Promise<boolean>
                  }
                  const guard = scopedWindow.__fasiumBoardNavigationGuard
                  if (guard) {
                    void guard(item.href)
                  } else {
                    window.location.assign(item.href)
                  }
                  if (variant === "mobile") {
                    setIsMobileMenuOpen(false)
                  }
                  return
                }
                if (item.href === "/tasks-record") {
                  void fetchPendingTasks()
                }
                if (variant === "mobile") {
                  setIsMobileMenuOpen(false)
                }
              }}
              aria-disabled={isItemDisabled}
              tabIndex={isItemDisabled ? -1 : undefined}
              className="flex items-center gap-3 flex-1 min-w-0 relative z-10"
            >
              <item.icon className={`${config.iconSize} flex-shrink-0`} />
              {shouldShowLabels && (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`${config.textClass} ${isItemDisabled ? "opacity-80" : ""}`}>{item.name}</span>
                    {item.badge && item.badgePlacement !== "corner" && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                        {item.badge}
                      </Badge>
                    )}
                    {variant === "mobile" && isItemDisabled && (
                      <Badge variant="outline" className="text-[10px] border-emerald-400/40 text-emerald-200/90 bg-emerald-500/10">
                        {item.comingSoonLabel || "敬请期待"}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </Link>
            {item.badge && item.badgePlacement === "corner" && (
              <span className="absolute right-3 top-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                {item.badge}
              </span>
            )}
            {item.children && (variant === "mobile" || isExpanded) && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleItemExpansion(item.href)
                }}
                className="relative z-10 text-muted-foreground hover:text-foreground"
                aria-label={isChildrenExpanded ? `收起${item.name}` : `展开${item.name}`}
              >
                {isChildrenExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            )}
            <AnimatePresence>
              {variant === "desktop" && isItemDisabled && hoveredItem === item.href && (
                <motion.div
                  key={`${item.href}-mask`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-between bg-background/90 px-3"
                >
                  <span className="flex items-center gap-2 text-xs text-emerald-200/90">
                    <item.icon className={`${config.iconSize} opacity-70`} />
                    {item.comingSoonLabel || "敬请期待"}
                  </span>
                  <Badge variant="outline" className="text-[10px] border-emerald-400/40 text-emerald-200/90 bg-emerald-500/10">
                    Soon
                  </Badge>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {item.children &&
            (variant === "desktop" ? (
              <AnimatePresence initial={false}>
                {shouldRenderChildren && (
                  <motion.div
                    key={`${item.href}-children`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1">{renderNavigationItems(item.children, variant, depth + 1)}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              shouldRenderChildren && (
                <div className="space-y-1">{renderNavigationItems(item.children, variant, depth + 1)}</div>
              )
            ))}
        </div>
      )
    })

  return (
    <>
      {/* Desktop Navigation */}
      {!isAuthPage && (
        <motion.nav
          initial={false}
          animate={{
            width: isExpanded ? 256 : 80,
          }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="hidden lg:flex fixed left-0 top-0 h-full border-r border-border shadow-lg shadow-black/10 dark:shadow-black/50 flex-col z-40 overflow-hidden bg-card min-h-0"
        >
          {/* Logo */}
          <div className="p-6 border-b border-border bg-card relative z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center justify-center">
                {isExpanded && (
                  <div>
                    <p className="font-serif text-2xl font-bold tracking-tight text-foreground">
                      Fasium
                      <span className="pl-1 font-sans text-lg font-light italic text-muted-foreground">AI</span>
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsDesktopCollapsed((prev) => !prev)}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-all hover:border-foreground/30 hover:text-foreground"
                aria-label={isDesktopCollapsed ? "展开导航栏" : "收起导航栏"}
              >
                {isDesktopCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 relative z-10">
            {renderNavigationItems(navigationItems, "desktop")}
          </div>

          {/* User Profile */}
          <div className="p-4 border-t border-border bg-card relative z-10">
            {isExpanded ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="w-full justify-start gap-3 p-3">
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="size-4 text-primary" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm">{user?.username || "User"}</p>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Diamond className="size-3 text-emerald-500" />
                        <span>{user?.credit ?? 0}</span>
                      </div>
                    </div>
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-sm font-medium">{user?.username || "User"}</div>
                  <div className="px-2 pb-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Diamond className="size-3 text-emerald-500" />
                    <span>{user?.credit ?? 0}</span>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/settings")}>
                    <Settings className="size-4 mr-2" />
                    {navCopy.userMenu.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="size-4 mr-2" />
                    {navCopy.userMenu.signOut}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="w-full justify-center p-3">
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="size-4 text-primary" />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-sm font-medium">{user?.username || "User"}</div>
                  <div className="px-2 pb-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Diamond className="size-3 text-emerald-500" />
                    <span>{user?.credit ?? 0}</span>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push("/settings")}>
                    <Settings className="size-4 mr-2" />
                    {navCopy.userMenu.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="size-4 mr-2" />
                    {navCopy.userMenu.signOut}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </motion.nav>
      )}

      {/* Mobile Navigation */}
      {!isAuthPage && (
        <div className="lg:hidden">
          {/* Mobile Header */}
          <header
            className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border flex items-center justify-between px-4 z-50"
            style={{ width: "100vw", maxWidth: "100vw" }}
          >
            <Link
              href="/dashboard"
              className="flex items-center gap-2 flex-1 min-w-0"
              style={{ maxWidth: "calc(100% - 60px)" }}
            >
              <div className="relative h-11 w-11 flex-shrink-0">
                <div className="absolute inset-0 rounded-xl bg-white" />
                <div className="relative h-full w-full rounded-xl border border-white bg-white/5 shadow-md shadow-emerald-500/25 overflow-hidden flex items-center justify-center">
                  <Image
                    src={fashionAiLogo}
                    alt="Fasium logo"
                    width={40}
                    height={40}
                    className="object-contain"
                    priority
                  />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-sm truncate">Fasium</h1>
                <p className="text-xs text-muted-foreground truncate">Design Studio</p>
              </div>
            </Link>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="flex-shrink-0"
            >
              {isMobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </Button>
          </header>

          {/* Mobile Menu Overlay */}
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* Mobile Menu */}
          <motion.nav
            initial={{ x: "-100%" }}
            animate={{ x: isMobileMenuOpen ? 0 : "-100%" }}
            transition={{ type: "spring", damping: 20, stiffness: 100 }}
            className="fixed left-0 top-16 bottom-0 w-full max-w-80 bg-card border-r border-border z-50 flex flex-col"
          >
            <div className="flex-1 p-4 space-y-2">{renderNavigationItems(navigationItems, "mobile")}</div>

            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="size-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{user?.username || "User"}</p>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Diamond className="size-3 text-emerald-500" />
                    <span>{user?.credit ?? 0}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full mb-2 flex items-center justify-center gap-2"
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  router.push("/settings")
                }}
              >
                <Settings className="size-4" />
                {navCopy.userMenu.settings}
              </Button>
              <Button variant="outline" className="w-full" onClick={handleLogout}>
                <LogOut className="size-4 mr-2" />
                {navCopy.userMenu.signOut}
              </Button>
            </div>
          </motion.nav>
        </div>
      )}
    </>
  )
}
