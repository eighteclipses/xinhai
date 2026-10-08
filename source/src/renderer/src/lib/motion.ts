import { useSyncExternalStore } from 'react'
import { useApp } from '../store/app'

const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribe = (notify: () => void) => {
  preference.addEventListener('change', notify)
  return () => preference.removeEventListener('change', notify)
}
export function useReducedEffects(): boolean {
  const system = useSyncExternalStore(subscribe, () => preference.matches)
  const reduced = useApp((s) => s.settings.reduceMotion)
  return reduced || system
}

export const MOTION = { feedback: 0.14, page: 0.32, growth: 1200, levelUp: 1500 } as const
