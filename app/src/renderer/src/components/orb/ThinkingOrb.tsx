import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

export type OrbState = 'idle' | 'listening' | 'thinking'

export interface ThinkingOrbProps {
  /** Rendered square size in px. */
  size: number
  state: OrbState
  /** Mutable normalized microphone energy, read directly by the canvas loop. */
  audioLevelRef: RefObject<number>
}

interface OrbPoint {
  /** Unit-sphere coordinates (Fibonacci lattice). */
  x: number
  y: number
  z: number
  /** Per-point phase for shimmer and swirl offsets. */
  phase: number
  /** Per-point radial drift target used while thinking. */
  drift: number
}

interface OrbMotion {
  /** Y-axis rotation speed, rad/s. */
  spin: number
  /** Radial shimmer amplitude (fraction of radius). */
  shimmer: number
  /** Shimmer frequency, Hz. */
  shimmerHz: number
  /** Whole-orb pulse amplitude (fraction of scale). */
  pulse: number
  /** Pulse frequency, Hz. */
  pulseHz: number
  /** How far points drift off the shell while reorganizing (0..1). */
  scatter: number
}

const MOTION: Record<OrbState, OrbMotion> = {
  idle: { spin: 0.18, shimmer: 0.012, shimmerHz: 0.4, pulse: 0.015, pulseHz: 0.22, scatter: 0 },
  listening: { spin: 0.42, shimmer: 0.05, shimmerHz: 1.4, pulse: 0.045, pulseHz: 1.1, scatter: 0 },
  thinking: { spin: 1.5, shimmer: 0.035, shimmerHz: 2.2, pulse: 0.02, pulseHz: 0.6, scatter: 0.35 }
}

const POINT_COUNT = 240
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** Fixed axis tilt so the sphere reads as 3D, not a spinning disc. */
const TILT = 0.42
/** Aubergine focus color from Atelier's selected primary. */
const DOT_RGB = '106, 78, 108'

const buildPoints = (): readonly OrbPoint[] => {
  const points: OrbPoint[] = []
  for (let i = 0; i < POINT_COUNT; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / POINT_COUNT
    const ring = Math.sqrt(1 - y * y)
    const theta = i * GOLDEN_ANGLE
    points.push({
      x: Math.cos(theta) * ring,
      y,
      z: Math.sin(theta) * ring,
      phase: (i * 2.399) % (Math.PI * 2),
      drift: Math.sin(i * 12.9898) * 0.5
    })
  }
  return points
}

const drawFrame = (
  ctx: CanvasRenderingContext2D,
  points: readonly OrbPoint[],
  size: number,
  dpr: number,
  angle: number,
  timeSec: number,
  motion: OrbMotion,
  audioLevel: number
): void => {
  const px = size * dpr
  ctx.clearRect(0, 0, px, px)
  const center = px / 2
  const pulse = 1 + motion.pulse * Math.sin(timeSec * motion.pulseHz * Math.PI * 2)
  const audioScale = 1 + audioLevel * 0.09
  const radius = px * 0.38 * pulse * audioScale
  const dotBase = Math.max(0.9, px * (0.014 + audioLevel * 0.003))
  const perspective = 3.2
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const cosT = Math.cos(TILT)
  const sinT = Math.sin(TILT)

  for (const point of points) {
    const shimmer =
      1 + motion.shimmer * Math.sin(timeSec * motion.shimmerHz * Math.PI * 2 + point.phase)
    const scatter =
      motion.scatter > 0
        ? 1 + motion.scatter * point.drift * Math.sin(timeSec * 1.7 + point.phase)
        : 1
    const r = shimmer * scatter
    // Rotate about Y, then tilt about X.
    const rx = point.x * cosA + point.z * sinA
    const rz0 = -point.x * sinA + point.z * cosA
    const ry = point.y * cosT - rz0 * sinT
    const rz = point.y * sinT + rz0 * cosT
    const depth = perspective / (perspective + rz * r)
    const sx = center + rx * r * radius * depth
    const sy = center + ry * r * radius * depth
    const alpha = 0.18 + 0.62 * ((1 - rz) / 2)
    ctx.beginPath()
    ctx.arc(sx, sy, dotBase * depth, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${DOT_RGB}, ${alpha.toFixed(3)})`
    ctx.fill()
  }
}

/**
 * The agent's visual presence: a particle-sphere of aubergine dots on a
 * transparent ground (reference: orbs.jakubantalik.com). Canvas 2D, no
 * dependencies. Motion is continuous across state changes: speeds ease
 * toward the active state's targets instead of restarting.
 * With prefers-reduced-motion, renders a single static dotted sphere.
 */
export function ThinkingOrb({ size, state, audioLevelRef }: ThinkingOrbProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<OrbState>(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      return
    }
    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr

    const points = buildPoints()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    let raf = 0
    let angle = 0.6
    let last = performance.now()
    // Eased copy of the motion params so state changes glide.
    const current: OrbMotion = { ...MOTION[stateRef.current] }

    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const target = MOTION[stateRef.current]
      const ease = Math.min(1, dt * 5)
      current.spin += (target.spin - current.spin) * ease
      current.shimmer += (target.shimmer - current.shimmer) * ease
      current.shimmerHz += (target.shimmerHz - current.shimmerHz) * ease
      current.pulse += (target.pulse - current.pulse) * ease
      current.pulseHz += (target.pulseHz - current.pulseHz) * ease
      current.scatter += (target.scatter - current.scatter) * ease
      angle += current.spin * dt
      const audioLevel = Math.max(0, Math.min(1, audioLevelRef.current))
      drawFrame(ctx, points, size, dpr, angle, now / 1000, current, audioLevel)
      raf = window.requestAnimationFrame(tick)
    }

    const start = (): void => {
      if (reduceMotion.matches) {
        const still: OrbMotion = { spin: 0, shimmer: 0, shimmerHz: 0, pulse: 0, pulseHz: 0, scatter: 0 }
        drawFrame(ctx, points, size, dpr, angle, 0, still, 0)
        return
      }
      last = performance.now()
      raf = window.requestAnimationFrame(tick)
    }

    const onMotionPreferenceChange = (): void => {
      window.cancelAnimationFrame(raf)
      start()
    }

    start()
    reduceMotion.addEventListener('change', onMotionPreferenceChange)
    return (): void => {
      window.cancelAnimationFrame(raf)
      reduceMotion.removeEventListener('change', onMotionPreferenceChange)
    }
  }, [audioLevelRef, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Alfred, ${state}`}
    />
  )
}
