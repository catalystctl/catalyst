import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-border/70 bg-surface-0/60 px-3 py-2 text-sm shadow-sm ring-offset-background transition-all duration-200 ease-standard placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
