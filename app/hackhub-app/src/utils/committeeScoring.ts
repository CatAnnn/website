import { getDigitalPioneerTracks, normalizeDigitalPioneerTrack } from '../config/digitalPioneer'
import type { Idea } from '../services/ideaService'
import type { JudgeScore, ScoreSummary } from '../services/judgingService'
import type { VotingCriteria } from '../services/votingService'
import { IdeaService } from '../services/ideaService'
import { getAllPages } from '../services/pagination'

export function officialCriteria(criteria: VotingCriteria[]): boolean {
  return criteria.length === 3 && [1, 2, 3].every((slot) => criteria.some((item) => item.name === `DPA track criterion ${slot}`))
}

export async function loadAllNominations(hackathonId: string) {
  return getAllPages((page) => IdeaService.getIdeas(hackathonId, page, 100))
}

export function rankCommitteeScores(scores: ScoreSummary[]) {
  const sorted = scores.map((score) => ({ ...score, panelScore: score.judgeCount === 0 ? null : score.panelScore })).sort((a, b) => (b.panelScore ?? -1) - (a.panelScore ?? -1) || a.ideaTitle.localeCompare(b.ideaTitle))
  let rank = 0
  return sorted.map((score, index) => {
    if (index === 0 || score.panelScore !== sorted[index - 1].panelScore) rank = index + 1
    return { ...score, displayRank: score.panelScore === null ? null : rank }
  })
}

export function savedEvaluation(scores: JudgeScore[]) {
  const note = scores.find((score) => score.comment)?.comment ?? ''
  const recommendation = /^Recommendation: ([^\n]+)/.exec(note)?.[1] ?? null
  return {
    scores: Object.fromEntries(scores.filter((score) => score.criterionId).map((score) => [score.criterionId!, score.score])),
    recommendation,
    comment: note.replace(/^Recommendation: [^\n]+\n*/, ''),
  }
}

export function criteriaForNomination(criteria: VotingCriteria[], idea: Idea): VotingCriteria[] {
  const type = idea.teamId ? 'team' : 'individual'
  const track = getDigitalPioneerTracks(type).find((item) => item.value === normalizeDigitalPioneerTrack(idea.category, idea.tags ?? []))
  if (!track || !officialCriteria(criteria)) return criteria
  return [...criteria].sort((a, b) => a.name.localeCompare(b.name)).map((criterion, index) => {
    const standard = track.standards[index]
    const weight = Number(/\((\d+)%\)/.exec(standard.title ?? '')?.[1])
    return { ...criterion, name: (standard.title ?? criterion.name).replace(/ \(\d+%\)$/, ''), description: standard.text, weight }
  })
}
