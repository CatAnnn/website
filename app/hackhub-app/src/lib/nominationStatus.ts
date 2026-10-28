import type { Idea } from '../services/ideaService'

export function nominationState(idea: Idea) {
  return idea.approvalStatus === 'approved' ? 'Approved / 审核通过'
    : idea.approvalStatus === 'rejected' ? 'Rejected — revise / 拒绝修改'
      : idea.approvalStatus === 'pending' ? 'In approval / 审核中' : 'Submitted'
}
