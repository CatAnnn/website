import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JudgingPanel } from './JudgingPanel'
import { IdeaService } from '../services/ideaService'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }))

const mocks = vi.hoisted(() => ({
  user: { id: 'judge-1', role: 'participant' }, hod: false,
  getCriteria: vi.fn(), applyAwardTemplate: vi.fn(),
  deleteEvaluation: vi.fn(), getJudges: vi.fn(), getMyScores: vi.fn(), submitEvaluation: vi.fn(), notify: vi.fn(),
}))
vi.mock('../hooks/useNominationEligibility', () => ({useNominationEligibility: () => ({data:{canReview:mocks.hod}, isLoading:false})}))
vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: mocks.user }) }))
vi.mock('@mantine/notifications', () => ({ notifications: { show: mocks.notify } }))
vi.mock('../services/judgingService', () => ({ JudgingService: mocks }))
vi.mock('../services/votingService', () => ({ VotingService: { getCriteria: mocks.getCriteria, applyAwardTemplate: mocks.applyAwardTemplate } }))
vi.mock('../services/ideaService', () => ({ IdeaService: { getIdeas: vi.fn(async () => ({ content: [
  { id: 'case-1', title: 'Customer value case', description: 'Measured impact', category: 'Customer Values', tags: [], status: 'submitted' },
], totalPages: 1 })) } }))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<MantineProvider env="test"><QueryClientProvider client={client}><MemoryRouter initialEntries={['/hackathons/award-1/judge']}><Routes>
    <Route path="/hackathons/:hackathonId/judge" element={<JudgingPanel />} />
  </Routes></MemoryRouter></QueryClientProvider></MantineProvider>)
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.hod = false
  mocks.getCriteria.mockResolvedValue([{ id: 'behavior', name: 'DPA track criterion 1', weight: 40 }, { id: 'impact', name: 'DPA track criterion 2', weight: 30 }, { id: 'growth', name: 'DPA track criterion 3', weight: 30 }])
  mocks.user.role = 'participant'
  mocks.getJudges.mockResolvedValue([{ userId: 'judge-1' }])
  mocks.getMyScores.mockResolvedValue([])
  mocks.submitEvaluation.mockResolvedValue([])
})

it('requires explicit scores and submits the Excel example as one complete evaluation', async () => {
  const user = userEvent.setup()
  mocks.submitEvaluation.mockResolvedValue([
    { id: 'saved-b', ideaId: 'case-1', judgeId: 'judge-1', criterionId: 'behavior', score: 8, comment: 'Recommendation: Recommend' },
    { id: 'saved-i', ideaId: 'case-1', judgeId: 'judge-1', criterionId: 'impact', score: 5, comment: 'Recommendation: Recommend' },
  ])
  show()
  const submit = await screen.findByRole('button', { name: 'Submit rating' })
  expect(submit).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: /Customer Impact score/ }), '8')
  expect(submit).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: /Deep Customer Insight score/ }), '5')
  await user.type(screen.getByRole('textbox', { name: /Growing Together With Customers score/ }), '9')
  expect(screen.getByText('7.4', { exact: true })).toBeInTheDocument()
  expect(submit).toBeDisabled()
  await user.click(screen.getByRole('textbox', { name: /Recommendation/ }))
  await user.click(await screen.findByRole('option', { name: 'Recommend', exact: true }))
  await user.type(screen.getByRole('textbox', { name: 'Comments, if any' }), 'Verified outcome')
  await user.click(submit)
  await waitFor(() => expect(mocks.submitEvaluation).toHaveBeenCalledWith('award-1', {
    ideaId: 'case-1', scores: [{ criterionId: 'behavior', score: 8 }, { criterionId: 'impact', score: 5 }, { criterionId: 'growth', score: 9 }],
    comment: 'Recommendation: Recommend\n\nVerified outcome',
  }))
  await screen.findByRole('button', { name: 'Delete rating' })
  expect(IdeaService.getIdeas).toHaveBeenCalledTimes(1)
  expect(mocks.getMyScores).toHaveBeenCalledTimes(1)
})

it('leaves partial historical evaluations incomplete and restores the saved value', async () => {
  mocks.getMyScores.mockResolvedValue([{ id: 'old-score', ideaId: 'case-1', judgeId: 'judge-1', criterionId: 'behavior', score: 8, comment: 'Recommendation: Recommend' }])
  show()
  expect(await screen.findByRole('textbox', { name: /Customer Impact score/ })).toHaveValue('8')
  expect(screen.getByRole('textbox', { name: /Deep Customer Insight score/ })).toHaveValue('')
  expect(screen.queryByText('Recorded')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Submit rating' })).toBeDisabled()
})

it('lets an unassigned manager review the form without submitting scores', async () => {
  mocks.user.role = 'admin'
  mocks.getJudges.mockResolvedValue([])
  show()
  expect(await screen.findByRole('textbox', { name: /Customer Impact score/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Submit rating' })).toBeDisabled()
  expect(mocks.getMyScores).not.toHaveBeenCalled()
})

it('deletes only the current judges complete evaluation and refreshes the form', async () => {
  mocks.getMyScores.mockResolvedValue([
    { id: 'b', ideaId: 'case-1', judgeId: 'judge-1', criterionId: 'behavior', score: 8, comment: 'Recommendation: Recommend' },
    { id: 'i', ideaId: 'case-1', judgeId: 'judge-1', criterionId: 'impact', score: 5, comment: 'Recommendation: Recommend' },
  ])
  mocks.deleteEvaluation.mockResolvedValue(undefined)
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Delete rating' }))
  mocks.getMyScores.mockResolvedValue([])
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }))
  expect(mocks.deleteEvaluation).toHaveBeenCalledWith('award-1', 'case-1')
  expect(await screen.findByRole('button', { name: 'Submit rating' })).toBeDisabled()
})

it('repairs an unscored invalid rubric from the blocked scoring screen', async () => {
  mocks.user.role = 'admin'
  mocks.getCriteria.mockResolvedValue([{ id: 'old', name: '111111', weight: 100 }])
  mocks.applyAwardTemplate.mockResolvedValue([{ id: 'behavior', name: 'DPA track criterion 1', weight: 40 }, { id: 'impact', name: 'DPA track criterion 2', weight: 30 }, { id: 'growth', name: 'DPA track criterion 3', weight: 30 }])
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Apply 2026 DPA template' }))
  expect(mocks.applyAwardTemplate).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Confirm official criteria' }))
  await waitFor(() => expect(mocks.applyAwardTemplate).toHaveBeenCalledWith('award-1'))
  expect(await screen.findByText('Score The Evidence')).toBeInTheDocument()
  expect(screen.queryByText('Check setup')).not.toBeInTheDocument()
})

it('keeps the invalid setup visible when existing scores prevent replacement', async () => {
  mocks.user.role = 'admin'
  mocks.getCriteria.mockResolvedValue([{ id: 'old', name: 'Custom', weight: 100 }])
  mocks.applyAwardTemplate.mockRejectedValue(new Error('Existing scores must be reviewed before replacing evaluation criteria.'))
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Apply 2026 DPA template' }))
  await userEvent.click(screen.getByRole('button', { name: 'Confirm official criteria' }))
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({color:'red'})))
  expect(screen.getByText('Check setup')).toBeInTheDocument()
  expect(screen.queryByText('Score The Evidence')).not.toBeInTheDocument()
})

it('allows a verified roster HoD to score without a committee assignment', async () => { mocks.hod = true; mocks.getJudges.mockResolvedValue([]); show(); expect(await screen.findByRole('textbox', {name:/Customer Impact score/})).toBeEnabled(); expect(mocks.getMyScores).toHaveBeenCalled(); })
