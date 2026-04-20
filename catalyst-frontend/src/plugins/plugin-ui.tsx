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
export { ScrollArea } from '../components/ui/scroll-area';

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
// Maps semantic names to the Tailwind classes used throughout Catalyst.
// Use these in plugin code for consistent styling that follows the design system.
export const SURFACE_0 = 'bg-background';
export const SURFACE_1 = 'bg-card';
export const SURFACE_2 = 'bg-surface-2';
export const SURFACE_3 = 'bg-surface-3';
export const TEXT_MUTED = 'text-muted-foreground';
export const TEXT_FOREGROUND = 'text-foreground';
export const TEXT_PRIMARY = 'text-primary';
export const BORDER_COLOR = 'border-border';
export const FONT_DISPLAY = 'font-display';
export const FONT_BODY = 'font-body';
export const FONT_MONO = 'font-mono';
export const ROUNDED_LG = 'rounded-lg';
export const ROUNDED_XL = 'rounded-xl';
export const SHADOW_ELEVATED = 'shadow-elevated';
export const SHADOW_ELEVATED_DARK = 'dark:shadow-elevated-dark';
