import type { Idea } from '../services/ideaService'

export function nominationState(idea: Idea) {
  return idea.approvalStatus === 'approved' ? 'Approved'
    : idea.approvalStatus === 'rejected' ? 'Rejected — revise'
      : idea.approvalStatus === 'pending' ? 'In approval' : 'Submitted'
}
