import { useEffect, useState } from 'react'
import { useSettings } from './queries'

/** Applies the theme preference (system / light / dark) to <html> and returns the effective theme. */
export function useThemeSync(): 'light' | 'dark' {
  const preference = useSettings().data?.theme ?? 'system'
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const effective = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  useEffect(() => {
    document.documentElement.classList.toggle('dark', effective === 'dark')
  }, [effective])
  return effective
}
