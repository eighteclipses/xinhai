import { useEffect, useRef } from 'react'

// One-action presentation dialogs keep keyboard focus inside and restore it afterwards.
export function usePresentationFocus() {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const layer = document.querySelector<HTMLElement>('.interface-layer')
    if (layer) layer.inert = true
    button.current?.focus()
    const trap = (event:KeyboardEvent) => {
      if (event.key === 'Tab') { event.preventDefault();button.current?.focus() }
    }
    window.addEventListener('keydown',trap,true)
    return () => {
      window.removeEventListener('keydown',trap,true)
      if (layer) layer.inert = layer.getAttribute('aria-hidden') === 'true'
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return button
}
