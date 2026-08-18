import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm dark:bg-black/60',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'duration-200',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogContentVariants = cva(
  [
    'pointer-events-auto relative flex w-full flex-col overflow-hidden',
    'max-h-[92dvh] border border-border/80 bg-card text-card-foreground shadow-elevated outline-none',
    'rounded-t-2xl sm:rounded-xl',
    'duration-200',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'sm:max-w-sm',
        md: 'sm:max-w-lg',
        lg: 'sm:max-w-xl',
        xl: 'sm:max-w-2xl',
        '2xl': 'sm:max-w-4xl',
        full: 'sm:h-[min(90dvh,56rem)] sm:max-w-[min(72rem,calc(100vw-3rem))]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export type DialogSize = NonNullable<VariantProps<typeof dialogContentVariants>['size']>;

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  showClose?: boolean;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = 'md', showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(dialogContentVariants({ size }), className)}
        {...props}
      >
        <div className="flex justify-center pb-0 pt-2 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="pressable absolute right-3.5 top-3.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  iconClassName?: string;
}

const DialogHeader = ({ className, icon, iconClassName, children, ...props }: DialogHeaderProps) => (
  <div
    className={cn('flex shrink-0 items-start gap-3 px-5 pb-3 pt-4 pr-12', className)}
    {...props}
  >
    {icon ? (
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-surface-2 text-muted-foreground',
          iconClassName,
        )}
      >
        {icon}
      </div>
    ) : null}
    <div className="min-w-0 flex-1 space-y-1">{children}</div>
  </div>
);
DialogHeader.displayName = 'DialogHeader';

const DialogToolbar = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'shrink-0 border-y border-border/70 bg-surface-2/50 px-5 py-2.5 first:border-t-0',
      className,
    )}
    {...props}
  />
);
DialogToolbar.displayName = 'DialogToolbar';

const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
);
DialogBody.displayName = 'DialogBody';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex shrink-0 flex-col gap-2 border-t border-border/70 bg-surface-1/80 px-5 py-3.5',
      'sm:flex-row sm:items-center sm:justify-end',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold leading-tight tracking-tight text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogToolbar,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
