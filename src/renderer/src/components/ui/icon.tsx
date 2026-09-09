import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Download,
  File,
  FileText,
  Film,
  Folder,
  FolderPlus,
  GripVertical,
  HelpCircle,
  Image as ImageIcon,
  Import,
  Layers,
  ListPlus,
  Loader2,
  Monitor,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Save,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Square,
  Star,
  Sun,
  Trash2,
  Upload,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@renderer/lib/utils";

const icons = {
  alert: AlertCircle,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  ban: Ban,
  bible: BookOpen,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  circle: Circle,
  clock: Clock,
  download: Download,
  file: File,
  fileText: FileText,
  video: Film,
  folder: Folder,
  folderPlus: FolderPlus,
  grip: GripVertical,
  help: HelpCircle,
  image: ImageIcon,
  import: Import,
  layers: Layers,
  addToSchedule: ListPlus,
  spinner: Loader2,
  display: Monitor,
  moon: Moon,
  audio: Music,
  pause: Pause,
  play: Play,
  add: Plus,
  ppt: Presentation,
  restart: RotateCcw,
  save: Save,
  search: Search,
  settings: Settings,
  prev: SkipBack,
  next: SkipForward,
  stop: Square,
  favorite: Star,
  sun: Sun,
  remove: Trash2,
  upload: Upload,
  volume: Volume2,
  close: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

type IconProps = {
  className?: string;
  decorative?: boolean;
  name: IconName;
};

/** Closed registry — no feature imports lucide-react directly, so every icon in
 *  the app is guaranteed to come from this one visually-consistent set. */
export function Icon({ className, decorative = true, name }: IconProps) {
  const Component = icons[name];
  return (
    <Component
      aria-hidden={decorative || undefined}
      className={cn("size-4", className)}
      focusable="false"
    />
  );
}
