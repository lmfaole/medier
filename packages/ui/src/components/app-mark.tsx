import { cn } from "cn"

import { ANY_APPS, type AnyAppId } from "../lib/apps"

interface AppMarkProps {
  app: AnyAppId
  size?: "sm" | "md"
  className?: string
}

/**
 * An app's icon on a tile in its colour: how every app recognises another.
 * Decorative (`aria-hidden`): the app's name always sits beside it, because a
 * colour or an icon alone says nothing to a screen reader or to someone who
 * cannot tell the hues apart.
 */
export function AppMark({ app, size = "md", className }: AppMarkProps) {
  const Icon = ANY_APPS[app].icon
  return (
    <span
      data-app={app}
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-(--app-color)/10 text-(--app-color)",
        size === "sm" ? "size-5" : "size-8",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-4"} />
    </span>
  )
}
