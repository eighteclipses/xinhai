import { useApp, type PageId } from '../store/app'

let request = 0

/** Navigate to an existing control without changing its value or opening an editor. */
export function goToSetting(page: PageId, target: string) {
  const current = ++request
  useApp.getState().go(page)
  let attempts = 0
  const locate = () => {
    if (current !== request || useApp.getState().page !== page) return
    const node = document.getElementById(target)
    if (node && node.getClientRects().length) {
      node.scrollIntoView({ block: 'start', behavior: useApp.getState().settings.reduceMotion ? 'auto' : 'smooth' })
      node.focus({ preventScroll: true })
      node.classList.remove('setting-arrival')
      // Restart the short outline when an entry is selected twice.
      void node.offsetWidth
      node.classList.add('setting-arrival')
      window.setTimeout(() => node.classList.remove('setting-arrival'), 2600)
    } else if (++attempts < 40) window.setTimeout(locate, 50)
  }
  window.requestAnimationFrame(locate)
}
