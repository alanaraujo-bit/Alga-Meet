/** The app's reduced-motion switch or the OS one (same rule as ui/Avatar). */
export const reducedMotion = (): boolean =>
  document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
