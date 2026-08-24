import { PaperTexture } from '@paper-design/shaders-react'
import type { ReactNode } from 'react'

/**
 * The paper stock: one static Paper Shaders texture over the whole window
 * (transparent back, warm fiber ink), dimmed by --paper-texture-opacity.
 * Renders once — speed 0 keeps the WebGL canvas idle after first paint.
 */
export function PaperBackdrop(): ReactNode {
  return (
    <div className="paper-backdrop" aria-hidden="true">
      <PaperTexture
        style={{ width: '100%', height: '100%' }}
        colorBack="#00000000"
        colorFront="#8d8477"
        contrast={0.18}
        roughness={0.22}
        fiber={0.32}
        fiberSize={0.1}
        crumples={0.05}
        crumpleSize={0.6}
        folds={0}
        foldCount={1}
        drops={0.08}
        fade={0.08}
        seed={7}
        scale={1.4}
        fit="cover"
        speed={0}
      />
    </div>
  )
}
