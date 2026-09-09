import {
  Activity,
  BadgeDollarSign,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Bug,
  Calculator,
  Camera,
  Car,
  Code2,
  Cpu,
  Database,
  Dumbbell,
  Flame,
  GitBranch,
  Globe2,
  GraduationCap,
  Heart,
  House,
  Landmark,
  Laptop,
  Library,
  Mountain,
  Music,
  NotebookTabs,
  Palette,
  Plane,
  Presentation,
  Rocket,
  ShoppingBag,
  Sparkles,
  Target,
  Terminal,
  Trophy,
  Users,
  Utensils
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ContextIcon } from '../../../shared/home'

export type ContextIconCategory =
  | 'Learning'
  | 'Work'
  | 'Life'
  | 'Technology'
  | 'Goals'
  | 'Creative'

export interface ContextIconOption {
  value: ContextIcon
  label: string
  category: ContextIconCategory
  glyph: LucideIcon
}

export const CONTEXT_ICON_CATEGORIES: readonly ContextIconCategory[] = [
  'Learning',
  'Work',
  'Life',
  'Technology',
  'Goals',
  'Creative'
]

export const CONTEXT_ICON_OPTIONS: readonly ContextIconOption[] = [
  { value: 'book-open', label: 'Book', category: 'Learning', glyph: BookOpen },
  { value: 'graduation-cap', label: 'Graduation', category: 'Learning', glyph: GraduationCap },
  { value: 'library', label: 'Library', category: 'Learning', glyph: Library },
  { value: 'notebook-tabs', label: 'Notebook', category: 'Learning', glyph: NotebookTabs },
  { value: 'brain', label: 'Brain', category: 'Learning', glyph: Brain },
  { value: 'calculator', label: 'Calculator', category: 'Learning', glyph: Calculator },
  { value: 'briefcase', label: 'Briefcase', category: 'Work', glyph: BriefcaseBusiness },
  { value: 'laptop', label: 'Laptop', category: 'Work', glyph: Laptop },
  { value: 'rocket', label: 'Rocket', category: 'Work', glyph: Rocket },
  { value: 'presentation', label: 'Presentation', category: 'Work', glyph: Presentation },
  { value: 'landmark', label: 'Institution', category: 'Work', glyph: Landmark },
  { value: 'badge-dollar-sign', label: 'Finance', category: 'Work', glyph: BadgeDollarSign },
  { value: 'house', label: 'Home', category: 'Life', glyph: House },
  { value: 'heart', label: 'Heart', category: 'Life', glyph: Heart },
  { value: 'users', label: 'People', category: 'Life', glyph: Users },
  { value: 'shopping-bag', label: 'Shopping', category: 'Life', glyph: ShoppingBag },
  { value: 'utensils', label: 'Food', category: 'Life', glyph: Utensils },
  { value: 'car', label: 'Car', category: 'Life', glyph: Car },
  { value: 'code', label: 'Code', category: 'Technology', glyph: Code2 },
  { value: 'terminal', label: 'Terminal', category: 'Technology', glyph: Terminal },
  { value: 'git-branch', label: 'Git branch', category: 'Technology', glyph: GitBranch },
  { value: 'bug', label: 'Bug', category: 'Technology', glyph: Bug },
  { value: 'database', label: 'Database', category: 'Technology', glyph: Database },
  { value: 'cpu', label: 'Processor', category: 'Technology', glyph: Cpu },
  { value: 'target', label: 'Target', category: 'Goals', glyph: Target },
  { value: 'trophy', label: 'Trophy', category: 'Goals', glyph: Trophy },
  { value: 'dumbbell', label: 'Fitness', category: 'Goals', glyph: Dumbbell },
  { value: 'activity', label: 'Activity', category: 'Goals', glyph: Activity },
  { value: 'flame', label: 'Flame', category: 'Goals', glyph: Flame },
  { value: 'mountain', label: 'Mountain', category: 'Goals', glyph: Mountain },
  { value: 'sparkles', label: 'Sparkles', category: 'Creative', glyph: Sparkles },
  { value: 'palette', label: 'Palette', category: 'Creative', glyph: Palette },
  { value: 'music', label: 'Music', category: 'Creative', glyph: Music },
  { value: 'camera', label: 'Camera', category: 'Creative', glyph: Camera },
  { value: 'plane', label: 'Travel', category: 'Creative', glyph: Plane },
  { value: 'globe', label: 'Globe', category: 'Creative', glyph: Globe2 }
]

const ICON_OPTIONS_BY_VALUE = new Map(
  CONTEXT_ICON_OPTIONS.map((option) => [option.value, option] as const)
)

export function contextIconLabel(icon: ContextIcon): string {
  const option = ICON_OPTIONS_BY_VALUE.get(icon)
  if (option === undefined) {
    throw new Error(`No label exists for context icon ${icon}`)
  }
  return option.label
}

export function ContextGlyph({ icon, size }: { icon: ContextIcon; size: number }): ReactNode {
  const option = ICON_OPTIONS_BY_VALUE.get(icon)
  if (option === undefined) {
    throw new Error(`No glyph exists for context icon ${icon}`)
  }
  const Glyph = option.glyph
  return <Glyph size={size} />
}
