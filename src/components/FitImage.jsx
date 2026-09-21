import { useEffect, useState } from 'react'
import { PostImage } from './ui/index'
import { previewFit } from '../lib/imageFit'

// A picture exactly as Instagram will show it: the shape it will be published
// at, padded (never cropped) when it is outside Instagram's range. Publishing
// pads such a picture (lib/imageFit), so a preview that filled a fixed frame
// showed people a cut-off logo for a post that went out whole.
function useShape(src) {
  const [shape, setShape] = useState(null)
  useEffect(() => {
    let live = true
    setShape(null)
    if (src) previewFit(src).then(f => { if (live) setShape(f) })
    return () => { live = false }
  }, [src])
  return shape
}

// Fills its parent's frame; used for thumbnails whose frame is fixed.
export default function FitImage({ src, style, ...rest }) {
  const shape = useShape(src)
  const padded = shape?.padded ? { objectFit: 'contain', background: shape.colour } : null
  return <PostImage src={src} style={{ ...style, ...padded }} {...rest} />
}

// Owns its frame, at the published ratio. `fallback` is only used until the
// picture has loaded and its real shape is known.
export function IgPicture({ src, fallback = '4 / 5', className = '', style }) {
  const shape = useShape(src)
  return (
    <div className={`overflow-hidden ${className}`}
      style={{ aspectRatio: shape ? String(shape.ratio) : fallback, background: shape?.colour || '#f5f5f5', ...style }}>
      <PostImage src={src} alt=""
        style={{ width: '100%', height: '100%', display: 'block', objectFit: shape?.padded ? 'contain' : 'cover' }} />
    </div>
  )
}
