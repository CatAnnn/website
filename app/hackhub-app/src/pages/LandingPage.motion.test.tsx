import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from './LandingPage'
vi.mock('../hooks/useNominationEligibility', () => ({ useNominationEligibility: () => ({ data: { canSubmit: false, canReview: false } }) }))

vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: null, logout: vi.fn() }) }))
vi.mock('../hooks/useAwardAccess', () => ({ useAwardAccess: () => ({ canReview: false, canManage: false }) }))

let reduced = false
let hidden = false
let motion: EventTarget

beforeEach(() => {
  reduced = false
  hidden = false
  motion = new EventTarget()
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    get matches() { return query === '(prefers-reduced-motion: reduce)' && reduced },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: motion.addEventListener.bind(motion),
    removeEventListener: motion.removeEventListener.bind(motion),
    dispatchEvent: motion.dispatchEvent.bind(motion),
  }))
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  // Playback must respect preferences even when Canvas is unavailable.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false })
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () => render(<MantineProvider env="test"><MemoryRouter><LandingPage /></MemoryRouter></MantineProvider>)

describe('LandingPage playback', () => {
  it('plays normally and pauses in the background, including late media events', () => {
    const { container } = renderPage()
    const video = container.querySelector('video')!
    expect(video.paused).toBe(false)
    expect(video).not.toHaveAttribute('autoplay')
    fireEvent.loadedData(video)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    hidden = true
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.loadedData(video)
    expect(video.paused).toBe(true)
    hidden = false
    fireEvent(document, new Event('visibilitychange'))
    expect(video.paused).toBe(false)
  })

  it('keeps video paused with reduced motion, then follows preference changes', () => {
    reduced = true
    const { container } = renderPage()
    const video = container.querySelector('video')!
    fireEvent.loadedData(video)
    fireEvent.pointerDown(window)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(video.paused).toBe(true)
    reduced = false
    motion.dispatchEvent(new Event('change'))
    expect(video.paused).toBe(false)
    reduced = true
    motion.dispatchEvent(new Event('change'))
    expect(video.paused).toBe(true)
  })

  it('removes playback listeners and stops video on unmount', () => {
    const { container, unmount } = renderPage()
    const video = container.querySelector('video')!
    unmount()
    vi.mocked(HTMLMediaElement.prototype.play).mockClear()
    fireEvent.loadedData(video)
    fireEvent.pointerDown(window)
    fireEvent(document, new Event('visibilitychange'))
    motion.dispatchEvent(new Event('change'))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(video.paused).toBe(true)
  })
})
