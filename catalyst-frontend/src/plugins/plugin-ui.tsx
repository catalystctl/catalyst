// src/plugins/plugin-ui.tsx
// Stable re-export barrel for UI components that plugins can import.
// Instead of fragile deep relative paths like ../../components/ui/button,
// plugins import from @/plugins/plugin-ui or ../plugin-ui.

// ── Utility ──
export { cn } from '../lib/utils';

// ── Button ──
export { Button, type ButtonProps } from '../components/ui/button';

// ── Card ──
export {
 Card,
 CardHeader,
 CardTitle,
 CardDescription,
 CardContent,
 CardFooter,
} from '../components/ui/card';

// ── Dialog ──
export {
 Dialog,
 DialogTrigger,
 DialogContent,
 DialogHeader,
 DialogTitle,
 DialogDescription,
 DialogFooter,
 DialogClose,
} from '../components/ui/dialog';

// ── AlertDialog ──
export {
 AlertDialog,
 AlertDialogTrigger,
 AlertDialogContent,
 AlertDialogHeader,
 AlertDialogTitle,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogAction,
 AlertDialogCancel,
} from '../components/ui/alert-dialog';

// ── Select ──
export {
 Select,
 SelectTrigger,
 SelectValue,
 SelectContent,
 SelectItem,
 SelectGroup,
 SelectLabel,
} from '../components/ui/select';

// ── DropdownMenu ──
export {
 DropdownMenu,
 DropdownMenuTrigger,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuLabel,
} from '../components/ui/dropdown-menu';

// ── Tabs ──
export {
 Tabs,
 TabsList,
 TabsTrigger,
 TabsContent,
} from '../components/ui/tabs';

// ── Input ──
export { Input } from '../components/ui/input';

// ── Textarea ──
export { Textarea } from '../components/ui/textarea';

// ── Label ──
export { Label } from '../components/ui/label';

// ── Badge ──
export { Badge, type BadgeProps } from '../components/ui/badge';

// ── Switch ──
export { Switch } from '../components/ui/switch';

// ── Checkbox ──
export { Checkbox } from '../components/ui/checkbox';

// ── Tooltip ──
export {
 Tooltip,
 TooltipTrigger,
 TooltipContent,
 TooltipProvider,
} from '../components/ui/tooltip';

// ── Popover ──
export {
 Popover,
 PopoverTrigger,
 PopoverContent,
} from '../components/ui/popover';

// ── ScrollArea ──
export { ScrollArea, ScrollBar } from '../components/ui/scroll-area';

// ── Separator ──
export { Separator } from '../components/ui/separator';

// ── Skeleton ──
export { Skeleton } from '../components/ui/skeleton';

// ── Avatar ──
export {
 Avatar,
 AvatarImage,
 AvatarFallback,
} from '../components/ui/avatar';

// ── Toggle / ToggleGroup ──
export { Toggle } from '../components/ui/toggle';
export {
 ToggleGroup,
 ToggleGroupItem,
} from '../components/ui/toggle-group';

// ── Table ──
export {
 Table,
 TableHeader,
 TableBody,
 TableRow,
 TableHead,
 TableCell,
} from '../components/ui/table';

// ── StatsCard ──
export { StatsCard } from '../components/ui/stats-card';

// ── Icons ──
export {
 Plus,
 X,
 Check,
 ChevronDown,
 ChevronRight,
 Search,
 Filter,
 MoreHorizontal,
 Settings,
 Trash2,
 Edit,
 Eye,
 EyeOff,
 AlertTriangle,
 Info,
 Copy,
 ExternalLink,
 RefreshCw,
 Loader2,
} from 'lucide-react';

// ── Design Token CSS Class Constants ──
// Re-exported from plugin-ui-constants for backward compatibility.
export {
  SURFACE_0,
  SURFACE_1,
  SURFACE_2,
  SURFACE_3,
  TEXT_MUTED,
  TEXT_FOREGROUND,
  TEXT_PRIMARY,
  BORDER_COLOR,
  FONT_DISPLAY,
  FONT_BODY,
  FONT_MONO,
  ROUNDED_LG,
  ROUNDED_XL,
  SHADOW_ELEVATED,
  SHADOW_ELEVATED_DARK,
} from './plugin-ui-constants';
