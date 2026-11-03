import { api } from '../lib/apiClient'
import { tokenStore } from '../lib/tokenStore'

// Signed URLs last an hour on the API. Keep a short, bounded, session-local cache.
const signedUrls = new Map<string, { url: string; expires: number }>()
const pendingUrls = new Map<string, Promise<string>>()
let cacheToken: string | null = null
let activeUrlRequests = 0
const urlQueue: Array<() => void> = []

async function requestSignedUrl(bucket: StorageBucket, key: string): Promise<string> {
  if (activeUrlRequests >= 6) await new Promise<void>((resolve) => urlQueue.push(resolve))
  else activeUrlRequests++
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('Photo URL request timed out. Please retry.'))
      }, 15_000)
    })
    const result = await Promise.race([api.get<{ url: string }>(
      `/api/v1/storage/url/${bucket}?key=${encodeURIComponent(key)}`, { signal: controller.signal }
    ), timeout])
    return result.url
  } finally {
    clearTimeout(timer)
    const next = urlQueue.shift()
    if (next) next()
    else activeUrlRequests--
  }
}

// Keep aligned with StoragePort.MAX_FILE_SIZE_BYTES and Spring multipart limits.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const PHOTO_UPLOAD_HINT = 'JPG, PNG or WebP; up to 50 MB per photo.'

export function validatePersonalPhoto(file: File | null): string | null {
  if (!file) return null
  if (file.size === 0) return 'The selected photo is empty. Please choose another photo.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Photo exceeds 50 MB. Please choose a smaller photo.'
  if (!PHOTO_ACCEPT.split(',').includes(file.type)) return 'Please choose a JPG, PNG or WebP photo.'
  return null
}

export interface UploadResult {
  key: string
  url: string
}

export type StorageBucket =
  | 'avatars'
  | 'team-files'
  | 'hackathon-assets'
  | 'project-attachments'
  | 'team-avatars'

export class StorageService {
  static async uploadFile(
    file: File,
    bucket: StorageBucket,
    prefix: string
  ): Promise<UploadResult> {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds 50 MB. Please choose a smaller file.')
    const form = new FormData()
    form.append('file', file)
    form.append('prefix', prefix)

    const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
    const res = await fetch(`${BASE_URL}/api/v1/storage/upload/${bucket}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenStore.getAccessToken() ?? ''}`,
      },
      body: form,
      credentials: 'include',
    })

    if (res.status === 413) {
      throw new Error('Upload size limit exceeded. The maximum file size is 50 MB. If your file is smaller, please contact the administrator to check the upload limit.')
    }
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
    return res.json()
  }

  static async getPresignedUrl(bucket: StorageBucket, key: string): Promise<string> {
    const token = tokenStore.getAccessToken()
    if (cacheToken !== token) {
      signedUrls.clear()
      pendingUrls.clear()
      cacheToken = token
    }
    const cacheKey = `${bucket}/${key}`
    const cached = signedUrls.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.url
    const pending = pendingUrls.get(cacheKey)
    if (pending) return pending
    const request = requestSignedUrl(bucket, key).then((url) => {
      if (cacheToken === token) {
        signedUrls.delete(cacheKey)
        if (signedUrls.size >= 256) signedUrls.delete(signedUrls.keys().next().value!)
        signedUrls.set(cacheKey, { url, expires: Date.now() + 5 * 60_000 })
      }
      return url
    }).finally(() => {
      if (pendingUrls.get(cacheKey) === request) pendingUrls.delete(cacheKey)
    })
    pendingUrls.set(cacheKey, request)
    return request
  }

  static async uploadTeamFile(teamId: string, file: File): Promise<UploadResult> {
    return StorageService.uploadFile(file, 'team-files', `teams/${teamId}`)
  }

  static async uploadHackathonBanner(hackathonId: string, file: File): Promise<UploadResult> {
    return StorageService.uploadFile(file, 'hackathon-assets', `banners/${hackathonId}`)
  }

  static async uploadProfileAvatar(userId: string, file: File): Promise<UploadResult> {
    return StorageService.uploadFile(file, 'avatars', `avatars/${userId}`)
  }
}

export const MAX_NOMINATION_PDF_BYTES = 10 * 1024 * 1024
export function validateNominationPdf(file: File | null): string | null {
  if (!file) return null
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) return 'Choose a PDF document.'
  if (file.size === 0) return 'The selected PDF is empty.'
  return file.size > MAX_NOMINATION_PDF_BYTES ? 'PDF must be 10 MB or smaller.' : null
}
