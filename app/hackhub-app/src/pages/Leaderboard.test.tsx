import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Leaderboard } from './Leaderboard'
import type { HackathonEvent } from '../contexts/RealtimeContext'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const mocks = vi.hoisted(() => ({
  user: { id: 'manager', role: 'admin' }, getAllScores: vi.fn(),
  getScoreSummary: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), connected: true,
}))
vi.mock('../hooks/useRealtime', () => ({ useRealtime: () => ({
  isConnected: mocks.connected, subscribeToHackathonUpdates: mocks.subscribe,
}) }))
vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: mocks.user }) }))
vi.mock('../services/ideaService', () => ({ IdeaService: { getIdeas: async () => ({ content: [
  { id: 'value', title: 'Value nominee', category: 'Digital Transformation', tags: [] },
  { id: 'innovation', title: 'Innovation nominee', category: 'Innovation Breakthrough', tags: [] },
  { id: 'collaboration', title: 'Collaboration nominee', category: 'Collaboration to Win', tags: [] },
  { id: 'tie', title: 'Tied nominee', category: 'Customer Values', tags: [] },
  { id: 'unscored', title: 'Unscored nominee', category: 'Customer Values', tags: [] },
], totalPages: 1 }) } }))
vi.mock('../services/judgingService', () => ({ JudgingService: {
  getAllScores: mocks.getAllScores,
  getJudges: async () => [{ userId: 'judge-1', name: 'Completed Judge' }, { userId: 'judge-2', name: 'Partial Judge' }],
  getScoreSummary: mocks.getScoreSummary,
} }))
vi.mock('../services/votingService', () => ({ VotingService: { getCriteria: async () => [
  { id: 'behavior', name: 'Behavior Demonstration', weight: 70 },
  { id: 'impact', name: 'Business Impact', weight: 30 },
] } }))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = () => <MantineProvider env="test"><QueryClientProvider client={client}><MemoryRouter><Leaderboard hackathonId="award-1" /></MemoryRouter></QueryClientProvider></MantineProvider>
  const result = render(view())
  return { ...result, rerender: () => result.rerender(view()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connected = true
  mocks.subscribe.mockReturnValue(mocks.unsubscribe)
  mocks.user.role = 'admin'
  mocks.getScoreSummary.mockResolvedValue([
    { ideaId: 'value', ideaTitle: 'Value nominee', panelScore: 7.1, judgeCount: 1, voteCount: 20 },
    { ideaId: 'innovation', ideaTitle: 'Innovation nominee', panelScore: 9, judgeCount: 1, voteCount: 2 },
    { ideaId: 'collaboration', ideaTitle: 'Collaboration nominee', panelScore: 6, judgeCount: 1, voteCount: 4 },
    { ideaId: 'tie', ideaTitle: 'Tied nominee', panelScore: 7.1, judgeCount: 1, voteCount: 0 },
    { ideaId: 'unscored', ideaTitle: 'Unscored nominee', panelScore: 0, judgeCount: 0, voteCount: 100 },
  ])
  mocks.getAllScores.mockResolvedValue([
    { ideaId: 'value', judgeId: 'judge-1', criterionId: 'behavior', score: 8, comment: 'Verified impact' },
    { ideaId: 'value', judgeId: 'judge-1', criterionId: 'impact', score: 5 },
    { ideaId: 'value', judgeId: 'judge-2', criterionId: 'behavior', score: 10 },
  ])
})

it('keeps each track separate with independent ranks, ties and unscored nominations', async () => {
  show()
  const values = await screen.findByRole('region', { name: 'Customer Values' })
  expect(within(values).getAllByText('#1')).toHaveLength(2)
  expect(within(values).getByText('Value nominee')).toBeInTheDocument()
  expect(within(values).queryByText('Innovation nominee')).not.toBeInTheDocument()
  expect(within(values).getByText('—')).toBeInTheDocument()
  for (const [track, title] of [['Innovation Breakthrough', 'Innovation nominee'], ['Collaboration To Win', 'Collaboration nominee']]) {
    const region = screen.getByRole('region', { name: track })
    expect(within(region).getByText('#1')).toBeInTheDocument()
    expect(within(region).getByText(title)).toBeInTheDocument()
    expect(within(region).queryByText('Value nominee')).not.toBeInTheDocument()
  }
})

it('expands and collapses criterion scores from the total and keeps partial evaluations incomplete', async () => {
  const user = userEvent.setup()
  show()
  const row = (await screen.findByText('Value nominee')).closest('tr')!
  const total = within(row).getByRole('button', { name: '7.10' })
  expect(total).toHaveAttribute('aria-expanded', 'false')
  await user.click(total)
  const details = await screen.findByRole('region', { name: 'Committee ratings · Value nominee' })
  expect(within(details).getByText('Behavior Demonstration (70%)')).toBeInTheDocument()
  expect(within(details).getByText('Business Impact (30%)')).toBeInTheDocument()
  expect(within(details).getByText('8')).toBeInTheDocument()
  expect(within(details).getByText('5')).toBeInTheDocument()
  expect(within(details).getByText('7.10')).toBeInTheDocument()
  expect(within(details).getByText('Incomplete')).toBeInTheDocument()
  expect(within(details).getByText('Pending')).toBeInTheDocument()
  await user.click(total)
  expect(screen.queryByRole('region', { name: 'Committee ratings · Value nominee' })).not.toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'View ratings' }))
  expect(total).toHaveAttribute('aria-expanded', 'true')
})

it('shows detail loading errors without hiding the ranking', async () => {
  mocks.getAllScores.mockRejectedValue(new Error('Unavailable'))
  show()
  const row = (await screen.findByText('Value nominee')).closest('tr')!
  await userEvent.click(within(row).getByRole('button', { name: '7.10' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load individual ratings'))
  expect(screen.getByRole('region', { name: 'Innovation Breakthrough' })).toBeInTheDocument()
})

it('keeps rankings restricted to managers', () => {
  mocks.user.role = 'participant'
  show()
  expect(screen.getByText('Manager Access Required')).toBeInTheDocument()
  expect(screen.queryByText('Committee Ranking')).not.toBeInTheDocument()
  expect(mocks.subscribe).not.toHaveBeenCalled()
})

it('refreshes the average, rank, judge count and open details when another judge submits', async () => {
  const { unmount } = show()
  const row = (await screen.findByText('Value nominee')).closest('tr')!
  await userEvent.click(within(row).getByRole('button', { name: '7.10' }))
  const onUpdate = mocks.subscribe.mock.calls[0][1] as (event: HackathonEvent) => void
  expect(mocks.subscribe.mock.calls[0][0]).toBe('award-1')
  mocks.getScoreSummary.mockResolvedValue([
    { ideaId: 'value', ideaTitle: 'Value nominee', panelScore: 6.5, judgeCount: 2, voteCount: 20 },
    { ideaId: 'tie', ideaTitle: 'Tied nominee', panelScore: 7.1, judgeCount: 1, voteCount: 0 },
  ])
  mocks.getAllScores.mockResolvedValue([
    { ideaId: 'value', judgeId: 'judge-1', criterionId: 'behavior', score: 6 },
    { ideaId: 'value', judgeId: 'judge-1', criterionId: 'impact', score: 6 },
    { ideaId: 'value', judgeId: 'judge-2', criterionId: 'behavior', score: 7 },
    { ideaId: 'value', judgeId: 'judge-2', criterionId: 'impact', score: 7 },
  ])
  act(() => onUpdate({ event: 'JUDGE_SCORES_UPDATED', ideaId: 'value' }))
  await waitFor(() => expect(within(row).getByRole('button', { name: '6.50' })).toHaveAttribute('aria-expanded', 'true'))
  expect(within(row).getByText('#2')).toBeInTheDocument()
  expect(within(row).getByText('2')).toBeInTheDocument()
  const details = screen.getByRole('region', { name: 'Committee ratings · Value nominee' })
  await waitFor(() => expect(within(details).queryByText('Incomplete')).not.toBeInTheDocument())
  for (const [name, score] of [['Completed Judge', '6'], ['Partial Judge', '7']]) {
    const judgeRow = within(details).getByText(name).closest('tr')!
    expect(within(judgeRow).getAllByText(score)).toHaveLength(2)
    expect(within(judgeRow).getByText(`${score}.00`)).toBeInTheDocument()
  }
  mocks.getScoreSummary.mockResolvedValue([
    { ideaId: 'value', ideaTitle: 'Value nominee', panelScore: 7, judgeCount: 3, voteCount: 20 },
  ])
  act(() => onUpdate({ event: 'JUDGE_SCORES_UPDATED', ideaId: 'value' }))
  await waitFor(() => expect(within(row).getByRole('button', { name: '7.00' })).toBeInTheDocument())
  expect(within(row).getByText('3')).toBeInTheDocument()
  unmount()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

it('resubscribes and retrieves missed scores after reconnecting', async () => {
  const { rerender } = show()
  await screen.findByText('Value nominee')
  mocks.connected = false
  rerender()
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  mocks.getScoreSummary.mockResolvedValue([
    { ideaId: 'value', ideaTitle: 'Value nominee', panelScore: 8, judgeCount: 2, voteCount: 20 },
  ])
  mocks.connected = true
  rerender()
  await screen.findByRole('button', { name: '8.00' })
  expect(mocks.subscribe).toHaveBeenCalledTimes(2)
})

it('does not fetch individual ratings until a row is expanded', async () => {
  show()
  const row = (await screen.findByText('Value nominee')).closest('tr')!
  expect(mocks.getAllScores).not.toHaveBeenCalled()
  await userEvent.click(within(row).getByRole('button', { name: 'View ratings' }))
  await waitFor(() => expect(mocks.getAllScores).toHaveBeenCalledTimes(1))
})

it('coalesces a burst of rating notifications into one refresh', async () => {
  show()
  await screen.findByText('Value nominee')
  const before = mocks.getScoreSummary.mock.calls.length
  const onUpdate = mocks.subscribe.mock.calls[0][1] as (event: HackathonEvent) => void
  act(() => {
    for (let i = 0; i < 5; i++) onUpdate({ event: 'JUDGE_SCORES_UPDATED', ideaId: 'value' })
  })
  await waitFor(() => expect(mocks.getScoreSummary).toHaveBeenCalledTimes(before + 1))
  expect(mocks.getAllScores).not.toHaveBeenCalled()
})
