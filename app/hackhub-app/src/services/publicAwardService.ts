import { api } from '../lib/apiClient'
import type { Hackathon, PageResponse } from './hackathonService'

export type AwardSummary = Pick<Hackathon, 'id' | 'title' | 'status'>
export interface PublicNomination {
  id: string
  title: string
  description: string
  hackathon_id: string
  nomination_type?: 'individual' | 'team'
  nominee_name: string
  nominee_org_code: string
  category: string
  technologies: string[]
  images: string[]
  votes: number
  status: 'draft' | 'submitted' | 'in-progress' | 'completed'
  created_at: string
  submission_date: string
  github_url?: string
  demo_url?: string
}
export const PublicAwardService = {
  getAwards: (page = 0) => api.get<PageResponse<AwardSummary>>(`/api/v1/public/awards?page=${page}&size=100`, { skipAuth: true }),
  getNominations: (id: string, page = 0) => api.get<PageResponse<PublicNomination>>(`/api/v1/public/awards/${id}/nominations?page=${page}&size=100`, { skipAuth: true }),
}
