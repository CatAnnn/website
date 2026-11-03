import { describe, expect, it, vi } from 'vitest'
import { loadAllNominations, officialCriteria, rankCommitteeScores, savedEvaluation } from './committeeScoring'
import { IdeaService } from '../services/ideaService'
import type { ScoreSummary, JudgeScore } from '../services/judgingService'
import type { VotingCriteria } from '../services/votingService'
vi.mock('../services/ideaService', () => ({ IdeaService: { getIdeas: vi.fn() } }))
const criterion = (name: string, weight: number) => ({ id: name, name, weight }) as VotingCriteria
const summary = (ideaId: string, panelScore: number | null, voteCount = 0): ScoreSummary => ({ ideaId, ideaTitle: ideaId, panelScore, voteCount, blendedScore: 10, communityScore: 10, rank: 1, judgeCount: panelScore === null ? 0 : 1 })
describe('committee scoring', () => {
  it('requires exact official weights and criterion identities', () => {
    expect(officialCriteria([criterion('DPA track criterion 1', 40), criterion('DPA track criterion 2', 30), criterion('DPA track criterion 3', 30)])).toBe(true)
    expect(officialCriteria([criterion('Behavior Demonstration', 30), criterion('Business Impact', 70)])).toBe(false)
    expect(officialCriteria([criterion('Innovation', 70), criterion('Business Impact', 30)])).toBe(false)
  })
  it('ranks committee totals alone, shares ties, leaves unscored cases unranked', () => {
    const ranked = rankCommitteeScores([{ ...summary('Unscored', 0, 99), judgeCount: 0 }, summary('C', 7), summary('B', 9, 5), summary('A', 9)])
    expect(ranked.map((row) => [row.ideaId, row.displayRank])).toEqual([['A', 1], ['B', 1], ['C', 3], ['Unscored', null]])
  })
  it('restores scores, recommendation, and comments', () => {
    expect(savedEvaluation([{ criterionId: 'behavior', score: 9, comment: 'Recommendation: Recommend\n\nStrong evidence' } as JudgeScore])).toEqual({ scores: { behavior: 9 }, recommendation: 'Recommend', comment: 'Strong evidence' })
  })
  it('loads every page', async () => {
    vi.mocked(IdeaService.getIdeas).mockResolvedValueOnce({ content: [{ id: 'first' }], totalPages: 2 } as Awaited<ReturnType<typeof IdeaService.getIdeas>>).mockResolvedValueOnce({ content: [{ id: 'second' }] } as Awaited<ReturnType<typeof IdeaService.getIdeas>>)
    expect((await loadAllNominations('event')).map((idea) => idea.id)).toEqual(['first', 'second'])
    expect(IdeaService.getIdeas).toHaveBeenCalledWith('event', 1, 100)
  })
})
