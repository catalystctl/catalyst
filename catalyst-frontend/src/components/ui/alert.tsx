import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// NOTE: rounded-md is intentional here — Alert is a floating callout, not a
// deck surface. Deck rule for badges/alerts: neutral secondary/outline on
// deck, tinted success/warning/danger variants elsewhere.
const alertVariants = cva(
  "relative w-full rounded-md border p-4 shadow-panel flex items-start gap-3 [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "border-border/50 bg-card text-foreground",
        destructive:
          "border-destructive/40 bg-danger/10 text-destructive [&>svg]:text-destructive",
        warning:
          "border-warning/40 bg-warning/10 text-warning [&>svg]:text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
