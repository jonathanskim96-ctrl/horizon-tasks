import type { Category } from './types'

/** Auto-assigned palette for custom categories (from the v4 artifact); cycles indefinitely. */
export const PALETTE = [
  '#5b8cff', '#34c2b0', '#f2b84b', '#a687f0', '#4caf7d',
  '#f2789a', '#55c8f2', '#c98a4c', '#8fbf5b', '#d6688f',
] as const

// Exact colors from the v4 artifact; "Other" is a neutral grey outside the palette.
export const STARTER_CATEGORIES: { name: string; color: string }[] = [
  { name: 'MPH', color: '#5b8cff' },
  { name: 'Core Lab', color: '#34c2b0' },
  { name: 'KFAM', color: '#f2b84b' },
  { name: 'Admin', color: '#a687f0' },
  { name: 'Financial', color: '#4caf7d' },
  { name: 'Other', color: '#8b929c' },
]

/** Next palette color: the first unused one, then cycling by count. */
export function nextCategoryColor(existing: Category[]): string {
  const used = new Set(existing.map((c) => c.color.toLowerCase()))
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[existing.length % PALETTE.length]
}
