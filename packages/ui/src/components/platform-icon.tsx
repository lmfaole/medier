import { BrandIcon } from '@lmfaole/designsystem/components/brand-icon'
import { Gamepad2 } from '@lmfaole/designsystem/lib/icons'
import type { Brand } from '../lib/platforms'

/**
 * The logos of the platforms the collection names. Steam and PlayStation are the design system's `BrandIcon` (Simple Icons, CC0). Xbox and
 * Windows are not in Simple Icons, so their paths stay here: Font Awesome Free's brand icons (CC BY 4.0, fontawesome.com/license/free),
 * drawn in the text colour so a logo follows light and dark mode.
 */
const LOGOS: Readonly<Record<'xbox' | 'windows', { viewBox: string; label: string; path: string }>> = {
  xbox: { viewBox: '0 0 512 512', label: 'Xbox', path: 'M369.9 318.2c44.3 54.3 64.7 98.8 54.4 118.7-7.9 15.1-56.7 44.6-92.6 55.9-29.6 9.3-68.4 13.3-100.4 10.2-38.2-3.7-76.9-17.4-110.1-39-27.9-18.2-34.2-25.7-34.2-40.6 0-29.9 32.9-82.3 89.2-142.1 32-33.9 76.5-73.7 81.4-72.6 9.4 2.1 84.3 75.1 112.3 109.5zM188.6 143.8c-29.7-26.9-58.1-53.9-86.4-63.4-15.2-5.1-16.3-4.8-28.7 8.1-29.2 30.4-53.5 79.7-60.3 122.4-5.4 34.2-6.1 43.8-4.2 60.5 5.6 50.5 17.3 85.4 40.5 120.9 9.5 14.6 12.1 17.3 9.3 9.9-4.2-11-.3-37.5 9.5-64 14.3-39 53.9-112.9 120.3-194.4zm311.6 63.5c-16.9-80-67.5-130.3-74.6-130.3-7.3 0-24.2 6.5-36 13.9-23.3 14.5-41 31.4-64.3 52.8 42.4 53.3 102.2 139.4 122.9 202.3 6.8 20.7 9.7 41.1 7.4 52.3-1.7 8.5-1.7 8.5 1.4 4.6 6.1-7.7 19.9-31.3 25.4-43.5 7.4-16.2 15-40.2 18.6-58.7 4.3-22.5 3.9-70.8-.8-93.4zM141.3 43c47.7-2.5 109.7 34.5 114.3 35.4 .7 .1 10.4-4.2 21.6-9.7 63.9-31.1 94-25.8 107.4-25.2-63.9-39.3-152.7-50-233.9-11.7-23.4 11.1-24 11.9-9.4 11.2z' },
  windows: { viewBox: '0 0 448 512', label: 'Windows', path: 'M0 93.7l183.6-25.3 0 177.4-183.6 0 0-152.1zM0 418.3l183.6 25.3 0-175.2-183.6 0 0 149.9zm203.8 28l244.2 33.7 0-211.6-244.2 0 0 177.9zm0-380.6l0 180.1 244.2 0 0-213.8-244.2 33.7z' },
}

export function PlatformIcon({ brand, className }: { brand: Brand; className?: string | undefined }) {
  if (brand === 'steam' || brand === 'playstation') return <BrandIcon name={brand} size="xl" />
  const logo = LOGOS[brand]
  return (
    <svg viewBox={logo.viewBox} role="img" aria-label={logo.label} fill="currentColor" className={className}>
      <title>{logo.label}</title>
      <path d={logo.path} />
    </svg>
  )
}

/** The icon of every system that has no logo here: a controller, with the system's name on hover and for a screen reader. */
export function OtherPlatformIcon({ name, className }: { name: string; className?: string | undefined }) {
  return (
    <Gamepad2 role="img" aria-label={name} className={className}>
      <title>{name}</title>
    </Gamepad2>
  )
}
