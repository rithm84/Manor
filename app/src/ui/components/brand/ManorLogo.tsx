import type { ReactNode } from 'react'

export function ManorLogo({ className }: { className: string }): ReactNode {
  return <span className={className} aria-label="Manor">
    <svg viewBox="240 210 410 240" fill="currentColor" aria-hidden="true" width="40" height="26">
      <path d="M284 418C237 418 254 348 271 312C290 268 321 226 356 225C404 219 418 263 433 309L445 340C464 303 480 255 520 257C556 255 572 287 583 326C595 371 606 394 630 411C616 427 591 434 570 422C542 407 535 371 525 340C521 327 516 317 509 318C496 318 484 341 475 360C465 381 456 395 442 394C423 394 415 374 401 334C391 304 386 286 375 287C359 287 345 320 331 356C317 395 311 418 284 418Z"/>
    </svg>
    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Manor</span>
  </span>
}
