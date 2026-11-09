import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NominationApprovals } from './NominationApprovals'
import type { Idea } from '../services/ideaService'

const mocks = vi.hoisted(() => ({ get: vi.fn(), review: vi.fn(), canReview: true }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'reviewer' } }) }))
vi.mock('../hooks/useNominationEligibility', () => ({ useNominationEligibility: () => ({ data: { canReview: mocks.canReview } }) }))
vi.mock('../services/ideaService', () => ({ IdeaService: { getMyNominations: mocks.get, getNominationApprovals: mocks.get, reviewNominations: mocks.review } }))

const nomination = (id: string, approvalStatus: Idea['approvalStatus'] = 'pending') => ({
  id, title: `Employee ${id}`, category: 'Customer Values', createdBy: 'employee',
  description: `Submitted text ${id}\nActual employee achievements`, tags: ['Submitted tag'],
  createdAt: '2026-10-28T01:00:00Z', updatedAt: '2026-10-28T01:00:00Z',
  approvalStatus, approvalVersion: 3,
  approvalReason: approvalStatus === 'rejected' ? 'Please explain the measured impact.' : null,
  projectAttachments: [{ type: 'nomination', name: `Employee ${id}`, employeeEmail: 'employee@example.test', nomineeOrgCode: 'BD/Test' }],
})

function show(reviewMode = true, path = '/') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MantineProvider env="test"><MemoryRouter initialEntries={[path]}><NominationApprovals reviewMode={reviewMode} /></MemoryRouter></MantineProvider></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canReview = true
  mocks.get.mockResolvedValue([nomination('one'), nomination('two'), nomination('done', 'approved')])
  mocks.review.mockResolvedValue(undefined)
})

describe('Nominating HoD approval inbox', () => {
  it('selects pending rows only and sends their displayed versions for batch approval', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('checkbox', { name: /Select all pending/ }))
    expect(screen.getByRole('checkbox', { name: 'Select Employee done' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^Approve/ }))
    await user.click(screen.getByRole('button', { name: /^Confirm$/ }))
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([{ id: 'one', version: 3 }, { id: 'two', version: 3 }], 'approved', ''))
  })

  it('shows submitted fields and requires a revision reason before rejecting', async () => {
    const user = userEvent.setup()
    show(true, '/?id=one')
    expect(await screen.findByText(/Submitted text one/)).toHaveTextContent('Actual employee achievements')
    expect(screen.getByText('employee@example.test', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Number', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Requested for', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Name', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText(/Computer selection/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reject for revision/ }))
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /Reason for revision/ }), 'Provide the measured impact.')
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([{ id: 'one', version: 3 }], 'rejected', 'Provide the measured impact.'))
  })

  it('keeps the decision unsuccessful when the API rejects a stale version', async () => {
    mocks.review.mockRejectedValue(new Error('Nomination changed. Refresh before reviewing.'))
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('checkbox', { name: 'Select Employee one' }))
    await user.click(screen.getByRole('button', { name: /^Approve/ }))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    expect((await screen.findAllByText('Nomination changed. Refresh before reviewing.')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows employee rejection feedback and links to the existing revision form', async () => {
    mocks.get.mockResolvedValue([nomination('one', 'rejected')])
    show(false, '/?id=one')
    expect((await screen.findAllByText('Please explain the measured impact.'))[0]).toBeVisible()
    expect(screen.getByRole('link', { name: /Edit and resubmit/ })).toHaveAttribute('href', '/nominate?edit=one')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument()
  })

  it('does not request the review inbox for an unassigned account', () => {
    mocks.canReview = false
    show()
    expect(screen.getByText(/not assigned as a Nominating HoD/)).toBeInTheDocument()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('hides team tags in the submitted nomination details', async () => {
    mocks.get.mockResolvedValue([{ ...nomination('team'), teamId: 'team-id' }])
    show(false, '/?id=team')
    expect(await screen.findByText(/Submitted text team/)).toBeVisible()
    expect(screen.queryByText('Submitted tag')).not.toBeInTheDocument()
  })
})
