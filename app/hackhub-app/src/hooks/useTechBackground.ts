import { useEffect, type RefObject } from 'react'

type Point = { x: number; y: number }
type Wave = Point & { born: number }
type Spark = Point & {
  vx: number
  vy: number
  born: number
  life: number
  size: number
}

/** Adds the Frontend1 pointer effects to the landing-page background only. */
export function useTechBackground(
  hostRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  // Playback has one owner, independent of Canvas support and pointer effects.
  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof window.matchMedia !== 'function') return
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPlayback = () => {
      if (document.hidden || motionPreference.matches) {
        video.pause()
      } else if (video.paused) {
        void video.play().catch(() => {
          // Keep the poster when autoplay is unavailable; retry on interaction.
        })
      }
    }
    video.addEventListener('loadeddata', syncPlayback)
    document.addEventListener('visibilitychange', syncPlayback)
    motionPreference.addEventListener('change', syncPlayback)
    window.addEventListener('pointerdown', syncPlayback, { passive: true })
    syncPlayback()
    return () => {
      video.removeEventListener('loadeddata', syncPlayback)
      document.removeEventListener('visibilitychange', syncPlayback)
      motionPreference.removeEventListener('change', syncPlayback)
      window.removeEventListener('pointerdown', syncPlayback)
      video.pause()
    }
  }, [videoRef])

  useEffect(() => {
    const currentHost = hostRef.current
    const currentVideo = videoRef.current
    if (!currentHost || !currentVideo || typeof window.matchMedia !== 'function') return undefined
    const host: HTMLElement = currentHost
    const video: HTMLVideoElement = currentVideo

    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.className = 'tech-background-interaction'
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '2',
      pointerEvents: 'none',
      display: 'block',
    })

    const canvasContext = canvas.getContext('2d', { alpha: true })
    if (!canvasContext) return undefined
    const context = canvasContext
    host.appendChild(canvas)

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const coarsePointer = window.matchMedia('(pointer: coarse)')
    const tau = Math.PI * 2
    const interactiveSelector =
      "header, main, [role='dialog'], [role='menu'], a, button, input, select, textarea, label, summary, [contenteditable], [role='button'], [role='link']"
    let width = 1
    let height = 1
    let pixelRatio = 1
    let bounds = host.getBoundingClientRect()
    let animationFrame = 0
    let lastFrame = 0
    let lastInput = -Infinity
    let energy = 0
    let pointerPresent = false
    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 }
    const waves: Wave[] = []
    const sparks: Spark[] = []

    let seed = 2709
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const anchors = Array.from({ length: 78 }, () => ({
      x: random(),
      y: random(),
      phase: random() * tau,
      size: 0.7 + random() * 0.8,
    }))
    const satellites = Array.from({ length: 24 }, () => ({
      angle: random() * tau,
      radius: 26 + random() * 125,
      speed: 0.055 + random() * 0.085,
      size: 0.8 + random() * 0.8,
      phase: random() * tau,
    }))

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value))
    const tint = (alpha: number) => `rgba(106,191,218,${clamp(alpha, 0, 1)})`
    const isInteractive = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(interactiveSelector))

    function wake() {
      if (!animationFrame && !document.hidden && !motionPreference.matches) {
        lastFrame = 0
        animationFrame = window.requestAnimationFrame(draw)
      }
    }

    function resize() {
      bounds = host.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      pixelRatio = Math.min(window.devicePixelRatio || 1, coarsePointer.matches ? 1.25 : 1.5)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      wake()
    }

    function stop() {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      lastFrame = 0
      energy = 0
      pointerPresent = false
      waves.length = 0
      sparks.length = 0
      video.style.transform = ''
      context.clearRect(0, 0, width, height)
    }

    const localPointer = (event: PointerEvent): Point => ({
      x: clamp((event.clientX - bounds.left) / width, 0, 1),
      y: clamp((event.clientY - bounds.top) / height, 0, 1),
    })

    function onMove(event: PointerEvent) {
      if (motionPreference.matches || event.pointerType === 'touch') return
      // Foreground navigation, forms and dialogs do not need background redraws.
      if (isInteractive(event.target)) {
        if (animationFrame || pointerPresent || waves.length || sparks.length) stop()
        return
      }
      const next = localPointer(event)
      if (!pointerPresent) {
        pointer.x = next.x
        pointer.y = next.y
      }
      pointer.targetX = next.x
      pointer.targetY = next.y
      pointerPresent = true
      lastInput = performance.now()
      wake()
    }

    function onPress(event: PointerEvent) {
      if (motionPreference.matches || event.button > 0 || isInteractive(event.target)) return
      const next = localPointer(event)
      const now = performance.now()
      waves.push({ ...next, born: now })
      if (waves.length > 5) waves.shift()
      const sparkCount = coarsePointer.matches ? 10 : 16
      for (let index = 0; index < sparkCount; index += 1) {
        const angle = random() * tau
        const speed = 35 + random() * 92
        sparks.push({
          ...next,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: now,
          life: 900 + random() * 650,
          size: 0.8 + random(),
        })
      }
      if (sparks.length > 90) sparks.splice(0, sparks.length - 90)
      wake()
    }

    function dot(x: number, y: number, radius: number, alpha: number) {
      context.fillStyle = tint(alpha)
      context.beginPath()
      context.arc(x, y, radius, 0, tau)
      context.fill()
    }

    function segment(
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      alpha: number,
      thickness = 0.65,
    ) {
      context.strokeStyle = tint(alpha)
      context.lineWidth = thickness
      context.beginPath()
      context.moveTo(startX, startY)
      context.lineTo(endX, endY)
      context.stroke()
    }

    function draw(now: number) {
      animationFrame = 0
      if (document.hidden || motionPreference.matches) return
      const delta = lastFrame ? clamp((now - lastFrame) / 1000, 0.001, 0.05) : 1 / 60
      lastFrame = now
      const follow = 1 - Math.exp(-delta * 8)
      pointer.x += (pointer.targetX - pointer.x) * follow
      pointer.y += (pointer.targetY - pointer.y) * follow
      const targetEnergy = pointerPresent && now - lastInput < 1500 ? 1 : 0
      energy += (targetEnergy - energy) * (1 - Math.exp(-delta * 3.5))
      const time = now / 1000
      context.clearRect(0, 0, width, height)

      const offsetX = (pointer.x - 0.5) * 9 * energy
      const offsetY = (pointer.y - 0.5) * 7 * energy
      video.style.transform =
        energy > 0.004
          ? `translate3d(${offsetX.toFixed(3)}px,${offsetY.toFixed(3)}px,0) scale(${(
              1 +
              0.018 * energy
            ).toFixed(5)})`
          : ''

      if (energy > 0.008) {
        const pointerX = pointer.x * width
        const pointerY = pointer.y * height
        const reach = Math.min(240, width * 0.4)
        const light = context.createRadialGradient(
          pointerX,
          pointerY,
          0,
          pointerX,
          pointerY,
          reach,
        )
        light.addColorStop(0, `rgba(40,121,190,${0.105 * energy})`)
        light.addColorStop(0.4, `rgba(22,98,164,${0.047 * energy})`)
        light.addColorStop(1, 'rgba(18,73,138,0)')
        context.fillStyle = light
        context.fillRect(pointerX - reach, pointerY - reach, reach * 2, reach * 2)

        const visible: Array<Point & { alpha: number }> = []
        for (const node of anchors) {
          const x = node.x * width + Math.sin(time * 0.12 + node.phase) * 8
          const y = node.y * height + Math.cos(time * 0.14 + node.phase) * 8
          const distance = Math.hypot(x - pointerX, y - pointerY)
          if (distance >= reach) continue
          const alpha = (1 - distance / reach) * energy
          visible.push({ x, y, alpha })
          dot(x, y, node.size, alpha * 0.83)
          segment(x, y, pointerX, pointerY, alpha * 0.18)
        }
        for (let first = 0; first < visible.length; first += 1) {
          for (let second = first + 1; second < visible.length; second += 1) {
            const a = visible[first]
            const b = visible[second]
            const distance = Math.hypot(a.x - b.x, a.y - b.y)
            if (distance < 135) {
              segment(
                a.x,
                a.y,
                b.x,
                b.y,
                (1 - distance / 135) * Math.min(a.alpha, b.alpha) * 0.45,
              )
            }
          }
        }

        const orbit: Point[] = []
        for (const satellite of satellites) {
          const angle = satellite.angle + time * satellite.speed
          const radius = satellite.radius * Math.min(1, width / 700)
          const x = pointerX + Math.cos(angle) * radius
          const y =
            pointerY +
            Math.sin(angle) * radius * 0.62 +
            Math.sin(time * 0.34 + satellite.phase) * 9
          const alpha = energy * (0.22 + 0.3 * (1 - radius / 160))
          orbit.push({ x, y })
          dot(x, y, satellite.size, alpha)
        }
        for (let index = 0; index < orbit.length - 1; index += 1) {
          const a = orbit[index]
          const b = orbit[index + 1]
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance < 87) {
            segment(a.x, a.y, b.x, b.y, energy * 0.14 * (1 - distance / 87))
          }
        }
      }

      for (let index = waves.length - 1; index >= 0; index -= 1) {
        const wave = waves[index]
        const progress = (now - wave.born) / 1700
        if (progress >= 1) {
          waves.splice(index, 1)
          continue
        }
        const x = wave.x * width
        const y = wave.y * height
        const eased = 1 - (1 - progress) ** 2
        const radius = 18 + eased * Math.min(285, width * 0.55)
        const alpha = (1 - progress) ** 1.75
        for (let ring = 0; ring < 2; ring += 1) {
          context.beginPath()
          context.arc(x, y, Math.max(1, radius - ring * 14), 0, tau)
          context.strokeStyle = tint(alpha * (ring ? 0.2 : 0.48))
          context.lineWidth = ring ? 0.7 : 1.1
          context.stroke()
        }
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index]
        const age = now - spark.born
        const progress = age / spark.life
        if (progress >= 1) {
          sparks.splice(index, 1)
          continue
        }
        const travel = (1 - Math.exp(-age / 750)) * 1.05
        const x = spark.x * width + spark.vx * travel
        const y = spark.y * height + spark.vy * travel
        const alpha = (1 - progress) ** 1.6 * 0.8
        segment(x - spark.vx * 0.045, y - spark.vy * 0.045, x, y, alpha * 0.32)
        dot(x, y, spark.size, alpha)
      }

      if (targetEnergy || energy > 0.004 || waves.length || sparks.length) {
        animationFrame = window.requestAnimationFrame(draw)
      } else {
        video.style.transform = ''
        context.clearRect(0, 0, width, height)
        lastFrame = 0
      }
    }

    function syncMotionPreference() {
      if (motionPreference.matches) {
        stop()
      }
    }

    const clearPointer = () => {
      pointerPresent = false
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onPress, { passive: true })
    document.documentElement.addEventListener('pointerleave', clearPointer, { passive: true })
    window.addEventListener('resize', resize, { passive: true })
    window.addEventListener('blur', clearPointer)
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionPreference.addEventListener('change', syncMotionPreference)
    resize()
    syncMotionPreference()

    return () => {
      stop()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onPress)
      document.documentElement.removeEventListener('pointerleave', clearPointer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('blur', clearPointer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionPreference.removeEventListener('change', syncMotionPreference)
      canvas.remove()
    }
  }, [hostRef, videoRef])
}
