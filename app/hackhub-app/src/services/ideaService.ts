import { api } from '../lib/apiClient'
import type { PageResponse } from './hackathonService'

export interface Idea {
  id: string
  title: string
  description: string
  hackathonId: string
  teamId: string | null
  createdBy: string
  category: string
  tags: string[]
  votes: number
  status: 'draft' | 'submitted' | 'in-progress' | 'completed'
  attachments: string[]
  repositoryUrl: string | null
  demoUrl: string | null
  projectAttachments: ProjectAttachment[] | null
  totalScore: number
  voteCount: number
  createdAt: string
  updatedAt: string
  userHasVoted?: boolean
  approvalStatus?: 'pending' | 'approved' | 'rejected' | null
  approvalReason?: string | null
  approvalReviewedAt?: string | null
  approvalReviewerName?: string | null
  approvalHeadName?: string | null
  approvalVersion?: number
}

export interface ProjectAttachment {
  type: 'nomination' | 'screenshot' | 'repository' | 'demo' | 'video' | 'document' | 'link'
  url: string
  name: string
  description?: string
  storageKey?: string
  nomineeUserId?: string
  nomineeOrgCode?: string
  nomineePosition?: string
  nominatingHead?: string
  employeeEmail?: string
  nominationType?: 'individual' | 'team'
  nominatorName?: string
  projectName?: string
  coreTeamMembers?: string
  achievementSummary?: string
  teamAchievementImpact?: string
  cultureDemonstration?: string
}

export interface CreateIdeaInput {
  title: string
  description: string
  hackathonId: string
  teamId?: string
  category: string
  tags?: string[]
  status?: Idea['status']
  repositoryUrl?: string | null
  demoUrl?: string | null
  projectAttachments?: ProjectAttachment[] | null
}

export interface UpdateIdeaInput {
  approvalVersion?: number
  title?: string
  description?: string
  category?: string
  tags?: string[]
  status?: Idea['status']
  repositoryUrl?: string | null
  demoUrl?: string | null
  projectAttachments?: ProjectAttachment[] | null
}

export interface VoteResult {
  voted: boolean
  voteCount: number
}

type IdeaResponse = Omit<Idea, 'projectAttachments'> & {
  projectAttachments: ProjectAttachment[] | string | null
}

function normalizeIdea(idea: IdeaResponse): Idea {
  let projectAttachments: ProjectAttachment[] = []
  if (Array.isArray(idea.projectAttachments)) {
    projectAttachments = idea.projectAttachments
  } else if (idea.projectAttachments) {
    try {
      const parsed: unknown = JSON.parse(idea.projectAttachments)
      if (Array.isArray(parsed)) projectAttachments = parsed as ProjectAttachment[]
    } catch {
      projectAttachments = []
    }
  }
  projectAttachments = projectAttachments.map((attachment) => {
    if (attachment.storageKey) return attachment
    try {
      const path = new URL(attachment.url, window.location.origin).pathname
      const bucketPrefix = '/hackhub-project-attachments/'
      const prefixIndex = path.indexOf(bucketPrefix)
      if (prefixIndex >= 0) {
        return {
          ...attachment,
          storageKey: decodeURIComponent(path.slice(prefixIndex + bucketPrefix.length)),
        }
      }
    } catch {
      // Preserve external or legacy URLs unchanged.
    }
    return attachment
  })
  return { ...idea, projectAttachments }
}

export class IdeaService {
  static async getMyNominations(): Promise<Idea[]> {
    return (await api.get<IdeaResponse[]>('/api/v1/me/nominations')).map(normalizeIdea)
  }

  static async getNominationApprovals(): Promise<Idea[]> {
    return (await api.get<IdeaResponse[]>('/api/v1/me/nomination-approvals')).map(normalizeIdea)
  }

  static async reviewNominations(items: Array<{ id: string; version: number }>, decision: 'approved' | 'rejected', reason: string): Promise<void> {
    await api.post('/api/v1/me/nomination-approvals', { items, decision, reason })
  }

  static async getIdeas(hackathonId: string, page = 0, size = 20): Promise<PageResponse<Idea>> {
    const response = await api.get<PageResponse<IdeaResponse>>(
      `/api/v1/hackathons/${hackathonId}/ideas?page=${page}&size=${size}`
    )
    return { ...response, content: response.content.map(normalizeIdea) }
  }

  static async getIdea(id: string): Promise<Idea> {
    return normalizeIdea(await api.get<IdeaResponse>(`/api/v1/ideas/${id}`))
  }

  static async createIdea(data: CreateIdeaInput): Promise<Idea> {
    const payload = {
      ...data,
      ...(data.projectAttachments !== undefined
        ? { projectAttachments: JSON.stringify(data.projectAttachments ?? []) }
        : {}),
    }
    return normalizeIdea(await api.post<IdeaResponse>(`/api/v1/hackathons/${data.hackathonId}/ideas`, payload))
  }

  static async updateIdea(id: string, updates: UpdateIdeaInput): Promise<Idea> {
    const payload = {
      ...updates,
      ...(updates.projectAttachments !== undefined
        ? { projectAttachments: JSON.stringify(updates.projectAttachments ?? []) }
        : {}),
    }
    return normalizeIdea(await api.put<IdeaResponse>(`/api/v1/ideas/${id}`, payload))
  }

  static async deleteIdea(id: string): Promise<void> {
    return api.delete(`/api/v1/ideas/${id}`)
  }

  static async deleteIdeas(ids: string[]): Promise<void> {
    return api.post('/api/v1/ideas/batch-delete', { ids })
  }

  /** Toggle vote — returns new state. Previously broken due to Supabase 406 errors. */
  static async voteIdea(ideaId: string): Promise<VoteResult> {
    return api.post(`/api/v1/ideas/${ideaId}/votes`)
  }

  static async submitVotes(ideaIds: string[]): Promise<void> {
    return api.post('/api/v1/me/votes', { ideaIds })
  }

  static async deleteVoteRecord(ideaId: string): Promise<void> {
    return api.delete(`/api/v1/me/votes/${ideaId}`)
  }

  static async clearMyVotes(): Promise<void> {
    return api.delete('/api/v1/me/votes')
  }

  static async clearTrackVotes(hackathonId: string, category: string): Promise<void> {
    return api.delete(`/api/v1/hackathons/${hackathonId}/votes?category=${encodeURIComponent(category)}`)
  }

  static async addComment(ideaId: string, content: string): Promise<Comment> {
    return api.post(`/api/v1/ideas/${ideaId}/comments`, { content })
  }

  static async updateComment(ideaId: string, commentId: string, content: string): Promise<Comment> {
    return api.put(`/api/v1/ideas/${ideaId}/comments/${commentId}`, { content })
  }

  static async deleteComment(ideaId: string, commentId: string): Promise<void> {
    return api.delete(`/api/v1/ideas/${ideaId}/comments/${commentId}`)
  }

  static async getComments(ideaId: string): Promise<Comment[]> {
    return api.get(`/api/v1/ideas/${ideaId}/comments`)
  }
}

export interface Comment {
  id: string
  ideaId: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
}
