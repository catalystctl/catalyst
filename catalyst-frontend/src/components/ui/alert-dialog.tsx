import * as React from 'react';
import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

const AlertDialog = AlertPrimitive.Root;

const AlertDialogTrigger = AlertPrimitive.Trigger;

const AlertDialogPortal = AlertPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm dark:bg-black/60',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'duration-200',
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertPrimitive.Overlay.displayName;

const alertDialogContentVariants = cva(
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
        md: 'sm:max-w-md',
        lg: 'sm:max-w-lg',
      },
    },
    defaultVariants: {
      size: 'sm',
    },
  },
);

export interface AlertDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof AlertPrimitive.Content>,
    VariantProps<typeof alertDialogContentVariants> {}

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Content>,
  AlertDialogContentProps
>(({ className, children, size = 'sm', ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <AlertPrimitive.Content
        ref={ref}
        className={cn(alertDialogContentVariants({ size }), className)}
        {...props}
      >
        <div className="flex justify-center pb-0 pt-2 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        {children}
      </AlertPrimitive.Content>
    </div>
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertPrimitive.Content.displayName;

export interface AlertDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  iconClassName?: string;
}

const AlertDialogHeader = ({
  className,
  icon,
  iconClassName,
  children,
  ...props
}: AlertDialogHeaderProps) => (
  <div className={cn('flex items-start gap-3 px-5 pt-4 pb-1', className)} {...props}>
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
    <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
  </div>
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col gap-2 px-5 py-4 sm:flex-row sm:justify-end',
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold leading-tight tracking-tight text-foreground', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
