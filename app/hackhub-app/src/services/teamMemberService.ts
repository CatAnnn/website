import { api } from '../lib/apiClient'

export interface TeamMemberMatch {
  id: string
  name: string
  orgUnit: string
}

export class TeamMemberService {
  static async search(query: string, signal?: AbortSignal): Promise<TeamMemberMatch[]> {
    return api.get(`/api/v1/team-members/search?q=${encodeURIComponent(query.trim())}`, { signal })
  }
}
