"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface CollapsibleHeaderProps {
  title: string
  description: string
  icon: React.ReactNode
  badge?: {
    icon: React.ReactNode
    text: string
  }
  actions?: React.ReactNode
}

export function CollapsibleHeader({ 
  title, 
  description, 
  icon, 
  badge, 
  actions 
}: CollapsibleHeaderProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate">{title}</h1>
              <p className="text-sm text-muted-foreground truncate">{description}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {badge && (
              <Badge variant="secondary" className="gap-1">
                {badge.icon}
                {badge.text}
              </Badge>
            )}
            
            {actions && (
              <div className="hidden lg:flex items-center gap-2">
                {actions}
              </div>
            )}
            
            {/* Mobile collapse button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="lg:hidden p-2"
            >
              {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </Button>
          </div>
        </div>
        
        {/* Collapsible content for mobile */}
        <AnimatePresence>
          {isCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="pt-4 border-t border-border mt-4">
                <div className="flex flex-col gap-4">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                  </div>
                  
                  {actions && (
                    <div className="flex flex-col gap-2">
                      {actions}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
