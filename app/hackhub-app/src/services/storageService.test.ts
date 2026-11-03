import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StorageService, MAX_UPLOAD_BYTES, validatePersonalPhoto, validateNominationPdf } from './storageService'

vi.mock('../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../lib/tokenStore', () => ({
  tokenStore: { getAccessToken: vi.fn().mockReturnValue('test-token') },
}))

import { api } from '../lib/apiClient'
import { tokenStore } from '../lib/tokenStore'
const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
}
let session = 0

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tokenStore.getAccessToken).mockReturnValue(`fixture-session-${++session}`)
  })

  describe('getPresignedUrl', () => {
    it('deduplicates simultaneous requests and reuses a fresh URL', async () => {
      mockApi.get.mockResolvedValue({ url: '/storage/fixture' })
      const results = await Promise.all(Array.from({ length: 20 }, () => StorageService.getPresignedUrl('avatars', 'shared')))
      expect(new Set(results)).toEqual(new Set(['/storage/fixture']))
      await StorageService.getPresignedUrl('avatars', 'shared')
      expect(mockApi.get).toHaveBeenCalledTimes(1)
    })

    it('expires cached URLs and isolates account changes', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
      mockApi.get.mockResolvedValue({ url: '/storage/fixture' })
      try {
        await StorageService.getPresignedUrl('avatars', 'shared')
        now.mockReturnValue(301001)
        await StorageService.getPresignedUrl('avatars', 'shared')
        vi.mocked(tokenStore.getAccessToken).mockReturnValue('different-fixture-session')
        await StorageService.getPresignedUrl('avatars', 'shared')
        expect(mockApi.get).toHaveBeenCalledTimes(3)
      } finally { now.mockRestore() }
    })

    it('retries failed lookups instead of caching a failure', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ url: '/storage/retry' })
      await expect(StorageService.getPresignedUrl('avatars', 'shared')).rejects.toThrow('offline')
      await expect(StorageService.getPresignedUrl('avatars', 'shared')).resolves.toBe('/storage/retry')
    })

    it('limits photo URL requests to six while still completing the queue', async () => {
      let active = 0
      let peak = 0
      mockApi.get.mockImplementation(async () => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        return { url: '/storage/fixture' }
      })
      await Promise.all(Array.from({ length: 30 }, (_, index) => StorageService.getPresignedUrl('avatars', `photo-${index}`)))
      expect(peak).toBe(6)
      expect(mockApi.get).toHaveBeenCalledTimes(30)
    })

    it('releases queue slots when photo URL requests stall', async () => {
      vi.useFakeTimers()
      for (let index = 0; index < 6; index++) mockApi.get.mockImplementationOnce(() => new Promise(() => {}))
      mockApi.get.mockResolvedValue({ url: '/storage/after-timeout' })
      try {
        const requests = Promise.allSettled(Array.from({ length: 7 }, (_, index) => StorageService.getPresignedUrl('avatars', `stalled-${index}`)))
        await vi.advanceTimersByTimeAsync(15_000)
        const results = await requests
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(6)
        expect(results[6]).toEqual({ status: 'fulfilled', value: '/storage/after-timeout' })
      } finally { vi.useRealTimers() }
    })

    it('calls correct endpoint and returns url', async () => {
      mockApi.get.mockResolvedValueOnce({ url: 'https://minio/bucket/key?sig=abc' })
      const result = await StorageService.getPresignedUrl('avatars', 'avatars/user-1.png')
      expect(mockApi.get).toHaveBeenCalledWith(
        '/api/v1/storage/url/avatars?key=avatars%2Fuser-1.png', expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(result).toBe('https://minio/bucket/key?sig=abc')
    })

    it('encodes key with special characters', async () => {
      mockApi.get.mockResolvedValueOnce({ url: 'https://minio/url' })
      await StorageService.getPresignedUrl('team-files', 'teams/t-1/my file.pdf')
      expect(mockApi.get).toHaveBeenCalledWith(
        '/api/v1/storage/url/team-files?key=teams%2Ft-1%2Fmy%20file.pdf', expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })
  })

  describe('uploadFile (actual implementation)', () => {
    it('sends form data and returns upload result', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ key: 'avatars/file.jpg', url: 'https://minio/file.jpg' }),
      }
      global.fetch = vi.fn().mockResolvedValueOnce(mockResponse)

      const file = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })
      const result = await StorageService.uploadFile(file, 'avatars', 'avatars/u-1')

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/storage/upload/avatars',
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.url).toBe('https://minio/file.jpg')
    })

    it('throws when response is not ok', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, statusText: 'Forbidden' })

      const file = new File(['content'], 'photo.jpg', { type: 'image/jpeg' })
      await expect(StorageService.uploadFile(file, 'avatars', 'avatars/u-1')).rejects.toThrow('Upload failed')
    })
  })

  it('validates photo sizes at the exact 50 MB boundary and supported types', () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES, configurable: true })
    expect(validatePersonalPhoto(file)).toBeNull()
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    expect(validatePersonalPhoto(file)).toContain('50 MB')
    expect(validatePersonalPhoto(new File([], 'empty.png', { type: 'image/png' }))).toContain('empty')
    expect(validatePersonalPhoto(new File(['data'], 'file.pdf', { type: 'application/pdf' }))).toContain('JPG')
  })

  it('blocks oversize uploads before sending any network request', async () => {
    global.fetch = vi.fn()
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    await expect(StorageService.uploadFile(file, 'project-attachments', 'nominations')).rejects.toThrow('50 MB')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('explains proxy 413 errors even when the response is HTML', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 413, statusText: 'Request Entity Too Large' })
    await expect(StorageService.uploadFile(new File(['image'], 'photo.png'), 'project-attachments', 'nominations'))
      .rejects.toThrow('If your file is smaller')
  })

  describe('uploadTeamFile', () => {
    it('delegates to uploadFile with correct bucket and prefix', async () => {
      const uploadSpy = vi.spyOn(StorageService, 'uploadFile').mockResolvedValueOnce({
        key: 'teams/t-1/doc.pdf',
        url: 'https://minio/doc.pdf',
      })
      const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' })
      await StorageService.uploadTeamFile('t-1', file)
      expect(uploadSpy).toHaveBeenCalledWith(file, 'team-files', 'teams/t-1')
      uploadSpy.mockRestore()
    })
  })

  describe('uploadHackathonBanner', () => {
    it('delegates to uploadFile with correct bucket and prefix', async () => {
      const uploadSpy = vi.spyOn(StorageService, 'uploadFile').mockResolvedValueOnce({
        key: 'banners/h-1/banner.png',
        url: 'https://minio/banner.png',
      })
      const file = new File(['img'], 'banner.png', { type: 'image/png' })
      await StorageService.uploadHackathonBanner('h-1', file)
      expect(uploadSpy).toHaveBeenCalledWith(file, 'hackathon-assets', 'banners/h-1')
      uploadSpy.mockRestore()
    })
  })

  describe('uploadProfileAvatar', () => {
    it('delegates to uploadFile with correct bucket and prefix', async () => {
      const uploadSpy = vi.spyOn(StorageService, 'uploadFile').mockResolvedValueOnce({
        key: 'avatars/u-1.jpg',
        url: 'https://minio/avatar.jpg',
      })
      const file = new File(['img'], 'avatar.jpg', { type: 'image/jpeg' })
      await StorageService.uploadProfileAvatar('u-1', file)
      expect(uploadSpy).toHaveBeenCalledWith(file, 'avatars', 'avatars/u-1')
      uploadSpy.mockRestore()
    })
  })
})

it('enforces the optional individual PDF size and type before upload', () => {
  expect(validateNominationPdf(null)).toBeNull()
  const pdf = new File(['%PDF-1.7'], 'evidence.pdf', {type:'application/pdf'})
  Object.defineProperty(pdf, 'size', {value:10 * 1024 * 1024, configurable:true})
  expect(validateNominationPdf(pdf)).toBeNull()
  Object.defineProperty(pdf, 'size', {value:10 * 1024 * 1024 + 1})
  expect(validateNominationPdf(pdf)).toMatch(/10 MB/)
  expect(validateNominationPdf(new File(['text'], 'evidence.txt', {type:'text/plain'}))).toMatch(/PDF/)
})
