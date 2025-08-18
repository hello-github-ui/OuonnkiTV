import { forwardRef } from 'react'

type Props = {
  width: number
  height: number
  left: number
  visible: boolean
}

const VideoProgressPreview = forwardRef<HTMLCanvasElement, Props>(
  ({ width, height, left, visible }, ref) => {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: '44px',
          transform: 'translateX(-50%)',
          left: `${left}px`,
          pointerEvents: 'none',
          zIndex: 30,
          opacity: visible ? 1 : 0,
          transition: 'opacity 120ms ease',
        }}
      >
        <canvas
          ref={ref}
          width={width}
          height={height}
          style={{ borderRadius: 8, background: '#000' }}
        />
      </div>
    )
  },
)

export default VideoProgressPreview
