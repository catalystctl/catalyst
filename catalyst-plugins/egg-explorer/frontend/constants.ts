// src/plugins/egg-explorer/constants.ts

export const IMAGE_FAMILIES: Record<
  string,
  { label: string; icon: string; color: string; bg: string }
> = {
  steam:  { label: 'Steam',  icon: '🚂', color: 'text-blue-400',    bg: 'bg-blue-500/15' },
  java:   { label: 'Java',   icon: '☕', color: 'text-orange-400',  bg: 'bg-orange-500/15' },
  wine:   { label: 'Wine',   icon: '🍷', color: 'text-purple-400',  bg: 'bg-purple-500/15' },
  source: { label: 'Source', icon: '🎮', color: 'text-red-400',     bg: 'bg-red-500/15' },
  mono:   { label: 'Mono',   icon: '⚙️', color: 'text-teal-400',    bg: 'bg-teal-500/15' },
  dotnet: { label: '.NET',   icon: '💠', color: 'text-violet-400',  bg: 'bg-violet-500/15' },
  proton: { label: 'Proton', icon: '🐧', color: 'text-cyan-400',    bg: 'bg-cyan-500/15' },
  debian: { label: 'Debian', icon: '📦', color: 'text-rose-400',    bg: 'bg-rose-500/15' },
  alpine: { label: 'Alpine', icon: '🏔️', color: 'text-sky-400',     bg: 'bg-sky-500/15' },
  other:  { label: 'Other',  icon: '🔧', color: 'text-zinc-400',    bg: 'bg-zinc-500/15' },
};

export const POPULAR_FAMILIES = ['steam', 'java', 'wine', 'source', 'debian', 'other'];
