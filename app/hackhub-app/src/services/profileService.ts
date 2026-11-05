import { api } from '../lib/apiClient'

export interface Profile {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'participant'
  avatarUrl: string | null
  skills: string[]
  organizationId: string | null
  createdAt: string
  updatedAt: string
}

export interface UpdateProfileInput {
  name?: string
  avatarUrl?: string
  skills?: string[]
}

export interface ProfileSearchResult {
  id: string
  name: string
  email: string
}

export class ProfileService {
  static async searchProfiles(query: string, signal?: AbortSignal): Promise<ProfileSearchResult[]> {
    return api.get(`/api/v1/profiles/search?q=${encodeURIComponent(query.trim())}`, { signal })
  }

  static async getCurrentProfile(): Promise<Profile> {
    return api.get('/api/v1/profiles/me')
  }

  static async getProfile(id: string): Promise<Profile> {
    return api.get(`/api/v1/profiles/${id}`)
  }

  static async updateProfile(updates: UpdateProfileInput): Promise<Profile> {
    return api.patch('/api/v1/profiles/me', updates)
  }
}
