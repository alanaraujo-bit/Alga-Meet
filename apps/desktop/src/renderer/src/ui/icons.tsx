/*
 * The app's icon vocabulary → Phosphor glyphs (one system, drawn through ui/Icon). Names stay the app's words
 * (Mic, Search, Settings…) so a feature never imports Phosphor directly; swap a glyph here and it changes everywhere.
 * Why Phosphor over Lucide: rounder, softer geometry and real weights — bold reads like Linear's 1.5 px at 16 px,
 * and `fill` gives the solid "you are here / it is on" state (docs/design/design-system.md §Ícones).
 */
import { forwardRef, useId } from 'react'
import type { Icon as PhosphorIcon, IconProps } from '@phosphor-icons/react'
import { Headphones as PhHeadphones, Monitor as PhMonitor } from '@phosphor-icons/react'

export type Glyph = PhosphorIcon

const STROKE: Record<string, number> = { thin: 8, light: 12, regular: 16, bold: 24, fill: 16, duotone: 16 }

/** Phosphor has no slashed headphones/monitor: draw the base glyph with Phosphor's own slash (48,48 → 208,224) cut in. */
function slashed(Base: PhosphorIcon, name: string): PhosphorIcon {
  const C = forwardRef<SVGSVGElement, IconProps>(({ size, weight = 'regular', color, mirrored: _m, ...rest }, ref) => {
    const id = useId()
    const w = STROKE[weight] ?? 16
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill={color ?? 'currentColor'} {...rest}>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="#fff" />
          <line x1="48" y1="48" x2="208" y2="224" stroke="#000" strokeWidth={w * 3} strokeLinecap="round" />
        </mask>
        <g mask={`url(#${id})`}>
          <Base size={256} weight={weight} />
        </g>
        <line x1="48" y1="48" x2="208" y2="224" stroke={color ?? 'currentColor'} strokeWidth={w} strokeLinecap="round" />
      </svg>
    )
  })
  C.displayName = name
  return C
}
export const HeadphoneOff = slashed(PhHeadphones, 'HeadphoneOff')
export const MonitorOff = slashed(PhMonitor, 'MonitorOff')

export {
  AppWindow,
  ArrowBendDownLeft as CornerDownLeft,
  ArrowBendUpLeft as CornerUpLeft,
  ArrowClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  ArrowDown,
  ArrowFatUp as ArrowBigUp,
  ArrowRight,
  ArrowsLeftRight as ArrowLeftRight,
  ArrowsLeftRight as ArrowRightLeft,
  ArrowsOut as Maximize2,
  ArrowSquareOut as ExternalLink,
  ArrowUp,
  Bell,
  CaretDown as ChevronDown,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CaretUpDown as ChevronsUpDown,
  CellSignalFull as Signal,
  ChartBar as BarChart3,
  ChatCircle as MessageCircle,
  Check,
  CheckCircle as CheckCircle2,
  CheckCircle as CircleCheck,
  Checks as CheckCheck,
  Clock,
  Code,
  Copy,
  CornersIn as Minimize,
  CornersOut as Maximize,
  CreditCard,
  Crown,
  Diamond as Gem,
  DotsThree as MoreHorizontal,
  DownloadSimple as Download,
  EnvelopeSimpleOpen as MailCheck,
  Eye,
  EyeSlash as EyeOff,
  File,
  FileArchive,
  FileArrowUp as FileUp,
  FileAudio,
  FileCode,
  FileLock as FileLock2,
  FileText,
  FileXls as FileSpreadsheet,
  FilmStrip,
  Flag,
  Flask as FlaskConical,
  GameController,
  Gavel,
  GearSix as Settings,
  Hash,
  Headphones,
  ImageBroken as ImageOff,
  ImageSquare as ImageUp,
  Info,
  Keyboard,
  Lifebuoy as LifeBuoy,
  Link,
  LinkSimple as Link2,
  LockSimple as Lock,
  LockSimpleOpen as LockOpen,
  MagnifyingGlass as Search,
  MagnifyingGlassMinus as ZoomOut,
  MagnifyingGlassPlus as ZoomIn,
  Microphone as Mic,
  MicrophoneSlash as MicOff,
  Minus,
  Monitor,
  MonitorArrowUp as MonitorUp,
  MusicNotes,
  PaintBrush,
  Palette,
  PaperPlaneRight as SendHorizontal,
  Paperclip,
  Pause,
  PauseCircle,
  PencilSimple as Pencil,
  Phone,
  PhoneDisconnect as PhoneOff,
  PhoneIncoming,
  PictureInPicture as PictureInPicture2,
  Play,
  Plus,
  Repeat,
  Power,
  Prohibit as Ban,
  Scan,
  Scroll as ScrollText,
  Shield,
  ShieldCheck,
  ShieldSlash as ShieldOff,
  ShieldWarning as ShieldAlert,
  SignOut as LogOut,
  SlidersHorizontal as Settings2,
  Smiley as Smile,
  Smiley as SmilePlus,
  SpeakerHigh as Volume2,
  SpeakerSlash as VolumeX,
  Square,
  SquaresFour as LayoutGrid,
  Trash as Trash2,
  User,
  UserCircle as UserRound,
  UserMinus,
  UserMinus as UserX,
  UploadSimple as Upload,
  UserPlus,
  Users,
  Warning as AlertTriangle,
  WarningCircle as AlertCircle,
  Waveform,
  WifiSlash as WifiOff,
  Wrench,
  X,
} from '@phosphor-icons/react'
