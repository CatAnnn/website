import { api } from '../lib/apiClient'

export interface Team {
  id: string
  name: string
  description: string
  hackathonId: string
  createdBy: string
  isOpen: boolean
  skills: string[]
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface TeamMember {
  id: string
  teamId: string
  userId: string
  role: 'leader' | 'member'
  joinedAt: string
}

export interface TeamWithMembers extends Team {
  members: TeamMember[]
}

export interface CreateTeamInput {
  name: string
  description: string
  hackathonId: string
  skills?: string[]
}

export class TeamService {
  static async getMyTeams(): Promise<TeamMember[]> {
    return api.get('/api/v1/me/teams')
  }

  static async getTeams(hackathonId: string): Promise<Team[]> {
    return api.get(`/api/v1/hackathons/${hackathonId}/teams`)
  }

  static async getTeam(id: string): Promise<TeamWithMembers> {
    return api.get(`/api/v1/teams/${id}`)
  }

  static async createTeam(data: CreateTeamInput): Promise<Team> {
    return api.post(`/api/v1/hackathons/${data.hackathonId}/teams`, data)
  }

  /** The API requires a team container, even for an individual nomination. */
  static async getOrCreateNominationTeam(data: CreateTeamInput, userId: string): Promise<Team> {
    const findMembership = async () => {
      const teams = await this.getTeams(data.hackathonId)
      const memberships = await Promise.all(teams.map(async (team) => ({
        team,
        members: await this.getTeamMembers(team.id),
      })))
      return memberships.find(({ members }) => members.some((member) => member.userId === userId))?.team
    }

    // Query at submission time: names can change and a prior photo upload may have failed.
    const existing = await findMembership()
    if (existing) return existing
    try {
      return await this.createTeam(data)
    } catch (error) {
      if (error instanceof Error && /already on a team|already taken/i.test(error.message)) {
        // Another tab may have created the container after our membership check.
        const concurrent = await findMembership()
        if (concurrent) return concurrent
      }
      throw error
    }
  }

  static async updateTeam(id: string, updates: Partial<CreateTeamInput>): Promise<Team> {
    return api.put(`/api/v1/teams/${id}`, updates)
  }

  static async joinTeam(teamId: string): Promise<TeamMember> {
    return api.post(`/api/v1/teams/${teamId}/members`)
  }

  static async leaveTeam(teamId: string): Promise<void> {
    return api.delete(`/api/v1/teams/${teamId}/members/me`)
  }

  static async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    return api.get(`/api/v1/teams/${teamId}/members`)
  }

  static async removeTeamMember(teamId: string, userId: string): Promise<void> {
    return api.delete(`/api/v1/teams/${teamId}/members/${userId}`)
  }
}
