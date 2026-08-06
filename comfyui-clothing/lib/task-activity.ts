"use client"

export type TaskActivityAction = "created" | "updated" | "deleted"

export type TaskActivityDetail = {
  action?: TaskActivityAction
  source?: string
  meta?: Record<string, unknown>
}

export const TASK_ACTIVITY_EVENT = "fashionai:tasks-updated"

/**
 * Broadcast a global signal to let UI surfaces (navbar, dashboards, etc.)
 * know that task data has changed and they should refresh if needed.
 */
export function notifyTaskActivity(detail: TaskActivityDetail = { action: "created" }) {
  if (typeof window === "undefined") {
    return
  }

  const payload: TaskActivityDetail = {
    action: "created",
    ...detail,
  }

  window.dispatchEvent(new CustomEvent<TaskActivityDetail>(TASK_ACTIVITY_EVENT, { detail: payload }))
}
