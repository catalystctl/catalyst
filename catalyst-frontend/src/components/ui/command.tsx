import { forwardRef } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { cn } from '../../lib/utils';

const Command = forwardRef<
 React.ElementRef<typeof CommandPrimitive>,
 React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
 <CommandPrimitive
 ref={ref}
 className={cn(
 'flex h-full w-full flex-col overflow-hidden rounded-md bg-card text-foreground',
 '[&_[cmdk-group]]:px-1',
 '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.625rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground',
 '[&_kbd]:ml-auto [&_kbd]:font-mono [&_kbd]:text-xs [&_kbd]:tracking-widest [&_kbd]:text-muted-foreground',
 className,
 )}
 {...props}
 />
));
Command.displayName = CommandPrimitive.displayName;

const CommandInput = forwardRef<
 React.ElementRef<typeof CommandPrimitive.Input>,
 React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
 <CommandPrimitive.Input
 ref={ref}
 className={cn(
 'flex h-9 w-full border-b border-border/70 bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground transition-colors duration-normal',
 className,
 )}
 {...props}
 />
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = forwardRef<
 React.ElementRef<typeof CommandPrimitive.List>,
 React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
 <CommandPrimitive.List
 ref={ref}
 className={cn('max-h-56 overflow-y-auto overflow-x-hidden py-1', className)}
 {...props}
 />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandItem = forwardRef<
 React.ElementRef<typeof CommandPrimitive.Item>,
 React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
 <CommandPrimitive.Item
 ref={ref}
 className={cn(
 'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-normal aria-selected:bg-primary/10 aria-selected:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
 className,
 )}
 {...props}
 />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandEmpty = forwardRef<
 React.ElementRef<typeof CommandPrimitive.Empty>,
 React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
 <CommandPrimitive.Empty ref={ref} className="py-4 text-center type-meta" {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export { Command, CommandInput, CommandList, CommandItem, CommandEmpty };
