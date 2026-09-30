import * as React from "react"

import { cn } from "@/lib/utils"

/** Shared dense-input class for compact fields: h-7 text-mini. Prefer `size="dense"` on Input. */
export const inputDenseClass = "h-7 px-2.5 text-mini"

export interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  size?: "default" | "dense"
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-sm border border-border/50 bg-card px-3 py-2 text-sm ring-offset-background transition-colors duration-normal ease-standard file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
          size === "dense" && inputDenseClass,
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
