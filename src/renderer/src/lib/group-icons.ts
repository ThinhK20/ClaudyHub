import {
  Accessibility,
  BadgeCheck,
  Bot,
  Boxes,
  Briefcase,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Code,
  Database,
  Files,
  Folder,
  Funnel,
  Globe,
  Inbox,
  Layers,
  LayoutTemplate,
  Megaphone,
  MessagesSquare,
  MonitorPlay,
  MousePointerClick,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Split,
  UserCog,
  Users,
  Workflow,
  type LucideIcon
} from 'lucide-react'

/** First matching rule wins, so more specific words come before general ones (e.g. "rollup filters" before "rollup"). */
const RULES: [RegExp, LucideIcon][] = [
  [/^$|general/, Inbox],
  [/action|button/, MousePointerClick],
  [/analytic|report|insight/, ChartColumn],
  [/template/, LayoutTemplate],
  [/approv|review/, BadgeCheck],
  [/communit|social/, Users],
  [/signage|display/, MonitorPlay],
  [/filter/, Funnel],
  [/rollup/, Layers],
  [/event|calendar/, CalendarDays],
  [/form|survey/, ClipboardList],
  [/mobile|app$/, Smartphone],
  [/teams|chat|teamwork/, MessagesSquare],
  [/odm|data|sor/, Database],
  [/openai|\bai\b|copilot|bot/, Bot],
  [/page|document|wcm|content/, Files],
  [/user|people|profile/, UserCog],
  [/permission|security|access/, ShieldCheck],
  [/publish|channel|news/, Megaphone],
  [/search/, Search],
  [/sync|import|export/, RefreshCw],
  [/sharepoint|site|tenant/, Network],
  [/spfx|code|api|dev/, Code],
  [/variation|language|translat/, Split],
  [/wcag|a11y|accessib/, Accessibility],
  [/workspace|project/, Briefcase],
  [/opm|process|workflow/, Workflow],
  [/web|portal/, Globe],
  [/module|package/, Boxes]
]

/** Icon for a library feature group, chosen from words in its folder name. Unknown groups get a folder. */
export function groupIcon(group: string): LucideIcon {
  const name = group.split('/')[0]?.toLowerCase().replace(/[-_]+/g, ' ') ?? ''
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? Folder
}
