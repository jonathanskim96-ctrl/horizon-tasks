import type { Category } from './types'

/** Auto-assigned palette for custom categories; cycles indefinitely. */
export const PALETTE = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c',
  '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#65a30d',
] as const

// TODO(colors): replace with the exact hexes from claude/tasklist-notes.md.
export const STARTER_CATEGORIES: { name: string; color: string }[] = [
  { name: 'MPH', color: '#2563eb' },
  { name: 'Core Lab', color: '#16a34a' },
  { name: 'KFAM', color: '#9333ea' },
  { name: 'Admin', color: '#ea580c' },
  { name: 'Financial', color: '#ca8a04' },
]

/** Next palette color: the first unused one, then cycling by count. */
export function nextCategoryColor(existing: Category[]): string {
  const used = new Set(existing.map((c) => c.color.toLowerCase()))
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[existing.length % PALETTE.length]
}
