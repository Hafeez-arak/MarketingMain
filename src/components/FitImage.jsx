import { useEffect, useState } from 'react'
import { PostImage } from './ui/index'
import { previewFit } from '../lib/imageFit'

// An Instagram picture as it will actually be published. A picture outside
// Instagram's accepted shape is padded at publish time (see lib/imageFit), so
// the preview must not crop it to fill the frame — that showed people a cut-off
// logo for a post that went out whole.
export default function FitImage({ src, style, ...rest }) {
  const [fit, setFit] = useState(null)
  useEffect(() => {
    let live = true
    setFit(null)
    if (src) previewFit(src).then(f => { if (live) setFit(f) })
    return () => { live = false }
  }, [src])
  const padded = fit ? { objectFit: 'contain', background: fit.colour } : null
  return <PostImage src={src} style={{ ...style, ...padded }} {...rest} />
}
