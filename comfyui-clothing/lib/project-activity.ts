"use client"

export type ProjectActivityScope = "invite" | "project"

export type ProjectActivityDetail = {
  scope?: ProjectActivityScope
  action?: string
  meta?: Record<string, unknown>
}

export const PROJECT_ACTIVITY_EVENT = "fashionai:project-activity"

export function notifyProjectActivity(detail: ProjectActivityDetail = { scope: "project" }) {
  if (typeof window === "undefined") {
    return
  }

  const payload: ProjectActivityDetail = {
    scope: "project",
    ...detail,
  }

  window.dispatchEvent(new CustomEvent<ProjectActivityDetail>(PROJECT_ACTIVITY_EVENT, { detail: payload }))
}
