import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useGLTF } from '@react-three/drei'
import './index.css'
import App from './App.tsx'

// drei's useGLTF defaults to Draco decoding on, but against a decoder
// fetched from Google's CDN (gstatic.com) unless told otherwise — every
// GLB load then depends on that CDN being reachable. Point it at the copy
// of the decoder three already ships (node_modules/three/examples/jsm/libs/draco/gltf/)
// so decoding works offline and isn't subject to a third party's uptime.
useGLTF.setDecoderPath(`${"/cad-assets/"}draco/`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
