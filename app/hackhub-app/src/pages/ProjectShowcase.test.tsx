vi.mock('../hooks/useRealtime', () => ({useRealtime: () => ({isConnected:false, subscribeToHackathonUpdates:vi.fn()})}))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render as renderView, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { ProjectShowcase } from './ProjectShowcase'
import { ProfileService } from '../services/profileService'
import { StorageService } from '../services/storageService'
import { TeamService } from '../services/teamService'

const { loadDraft, saveDraft, removeDraft } = vi.hoisted(() => ({ loadDraft: vi.fn(), saveDraft: vi.fn(), removeDraft: vi.fn() }))
vi.mock('../services/nominationDraftStore', () => ({
  nominationDraftKey: ({ userId, hackathonId, nominationType, editId }: { userId: string; hackathonId: string; nominationType: string; editId?: string | null }) => JSON.stringify([userId, hackathonId, nominationType, editId ?? 'new']),
  NominationDraftStore: { load: loadDraft, save: saveDraft, remove: removeDraft },
}))

const { createIdea, getIdea, createTeam, getOrCreateNominationTeam, getComments, addComment, getIdeas, getHackathons, updateIdea, uploadFile, voteIdea, clearMyVotes, clearTrackVotes, submitVotes, deleteVoteRecord, deleteIdea, deleteIdeas, currentUser, listNominees } = vi.hoisted(() => ({
  getIdea: vi.fn(),
  submitVotes: vi.fn().mockResolvedValue(undefined),
  deleteVoteRecord: vi.fn().mockResolvedValue(undefined),
  deleteIdea: vi.fn().mockResolvedValue(undefined),
  deleteIdeas: vi.fn().mockResolvedValue(undefined),
  currentUser: { id: 'user-1', email: 'user@example.com', name: 'User', role: 'participant' as 'participant' | 'manager' | 'admin', skills: [] },
  listNominees: vi.fn().mockResolvedValue({ content: [{ id: 'nominee-2', name: 'Named Associate', email: 'associate@example.com' }] }),
  getHackathons: vi.fn().mockResolvedValue({ content: [{ id: 'hackathon-1', title: 'Spring 2026 Hackathon', status: 'running' }] }),
  createIdea: vi.fn().mockResolvedValue({ id: 'new-idea' }),
  getOrCreateNominationTeam: vi.fn().mockResolvedValue({ id: 'personal-team', name: 'User nomination' }),
  getComments: vi.fn().mockResolvedValue([{ id: 'comment-1', ideaId: 'idea-1', userId: 'reviewer', content: 'The customer impact is well documented.', createdAt: '2026-09-01T00:00:00Z' }]),
  addComment: vi.fn().mockResolvedValue(undefined),
  createTeam: vi.fn().mockResolvedValue({ id: 'personal-team', name: 'User nomination' }),
  getIdeas: vi.fn().mockResolvedValue({
    content: [{
      id: 'idea-1',
      title: 'Customer Portal Renewal',
      description: 'Uploaded by an administrator',
      teamId: null,
      createdBy: 'user-1',
      category: 'AI',
      tags: ['Java'],
      attachments: [],
      projectAttachments: [],
      votes: 2,
      userHasVoted: false,
      status: 'submitted',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    }],
  }),
  updateIdea: vi.fn().mockResolvedValue({ id: 'new-idea' }),
  uploadFile: vi.fn().mockResolvedValue({ url: '/image.jpg', key: 'projects/personal-team/image.jpg' }),
  clearTrackVotes: vi.fn().mockResolvedValue(undefined),
  clearMyVotes: vi.fn().mockResolvedValue(undefined),
  voteIdea: vi.fn().mockResolvedValue({ voted: true, voteCount: 3 }),
}))

const render = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderView(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

Element.prototype.scrollIntoView = vi.fn()
Element.prototype.scrollTo = vi.fn()

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: currentUser }) }))
vi.mock('../hooks/useNominationEligibility', () => ({ useNominationEligibility: () => ({ data: { canSubmit: true, canReview: false, nominatingHead: 'Assigned HoD' } }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }))
vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>()
  return { ...actual, api: { ...actual.api, get: listNominees } }
})

vi.mock('../services/hackathonService', () => ({
  HackathonService: {
    getHackathons,
  },
}))

vi.mock('../services/ideaService', () => ({
  IdeaService: {
    getMyNominations: vi.fn().mockResolvedValue([]),
    getIdea,
    getIdeas,
    voteIdea,
    clearMyVotes,
    submitVotes,
    deleteVoteRecord,
    clearTrackVotes,
    createIdea,
    getComments,
    addComment,
    updateIdea,
    deleteIdea,
    deleteIdeas,
  },
}))

vi.mock('../services/teamService', () => ({
  TeamService: {
    getMyTeams: vi.fn().mockResolvedValue([]),
    getTeams: vi.fn().mockResolvedValue([{ id: 'team-1', name: 'Admin Team', hackathonId: 'hackathon-1' }]),
    getTeamMembers: vi.fn().mockResolvedValue([]),
    createTeam,
    getOrCreateNominationTeam,
  },
}))

vi.mock('../services/profileService', () => ({
  ProfileService: { getProfile: vi.fn().mockResolvedValue({ name: 'Reviewer' }) },
}))

vi.mock('../services/storageService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/storageService')>(),
  StorageService: {
    getPresignedUrl: vi.fn(),
    uploadFile,
  },
}))

vi.mock('../services/judgingService', () => ({
  JudgingService: { getJudges: vi.fn().mockResolvedValue([]) },
}))

describe('ProjectShowcase', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks()
    loadDraft.mockResolvedValue(null)
    saveDraft.mockImplementation(async (_key: string, data: unknown) => ({ version: 1, savedAt: '2026-11-09T00:00:00Z', data }))
    removeDraft.mockResolvedValue(undefined)
  })
  afterEach(() => { currentUser.role = 'participant' })
  it('carries Team query selection into the matching criteria and team creation flow', async () => {
    render(<MantineProvider><MemoryRouter initialEntries={['/nominate?type=team']}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    expect(screen.getByRole('button', { name: 'Team', exact: true })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('radio', { name: /Collaboration To Win/ }))
    expect(document.getElementById('nomination-track-description')).toHaveTextContent('Cross-Functional Synergy (30%)')
    await screen.findByRole('button', { name: 'Submit nomination' })
    expect(screen.queryByRole('textbox', { name: /Executive Summary/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Individual', exact: true }))
    await screen.findByRole('textbox', { name: /Executive Summary/ })
    expect(document.getElementById('nomination-track-description')).toHaveTextContent('Breaking Down Silos (30%)')
  })
  it('shows a white empty-window message only after a successful empty response', async () => {
    getHackathons.mockResolvedValueOnce({ content: [] })
    render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    fireEvent.click(screen.getByRole('radio', { name: /Customer Values/ }))
    const message = await screen.findByText('No nomination window is currently open.')
    expect(message).toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })
  it('distinguishes an API failure from an empty nomination window', async () => {
    getHackathons.mockRejectedValueOnce(new Error('Unavailable'))
    render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    fireEvent.click(screen.getByRole('radio', { name: /Customer Values/ }))
    const message = await screen.findByText('Unable to load nominations. Refresh the page to try again.')
    expect(message).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    expect(screen.queryByText('No nomination window is currently open.')).not.toBeInTheDocument()
  })
  it('shares duplicate profile and image requests within a load, then refreshes them on remount', async () => {
    const page = { content: [1, 2].map((id) => ({
      id: `shared-${id}`, title: `Shared nominee ${id}`, description: 'Shared assets',
      createdBy: 'shared-user', category: 'Customer Values', tags: [], attachments: [],
      projectAttachments: [{ type: 'screenshot', storageKey: 'shared-photo', url: '/fallback.jpg' }],
      votes: 0, userHasVoted: false, status: 'submitted',
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    })) }
    getIdeas.mockResolvedValueOnce(page).mockResolvedValueOnce(page)
    vi.mocked(StorageService.getPresignedUrl).mockResolvedValue('/shared-photo.jpg')
    const show = () => render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    const first = show()
    await screen.findByText('Shared nominee 2')
    expect(ProfileService.getProfile).toHaveBeenCalledTimes(1)
    expect(StorageService.getPresignedUrl).toHaveBeenCalledTimes(1)
    expect(TeamService.getTeamMembers).not.toHaveBeenCalled()
    first.unmount()
    show()
    await screen.findByText('Shared nominee 2')
    expect(ProfileService.getProfile).toHaveBeenCalledTimes(2)
    expect(StorageService.getPresignedUrl).toHaveBeenCalledTimes(2)
  })

  it('defers offscreen photos, loads nearby photos and allows retry after a failed request', async () => {
    const originalObserver = globalThis.IntersectionObserver
    const observers: Array<{ notify: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(callback: IntersectionObserverCallback) {
        observers.push({
          notify: (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
          disconnect: this.disconnect,
        })
      }
    })
    getIdeas.mockResolvedValueOnce({ content: [1, 2].map((id) => ({
      id: `photo-${id}`, title: `Photo nominee ${id}`, description: 'Photo loading',
      createdBy: 'creator', category: 'Customer Values', tags: [], attachments: [`/photo-${id}.webp`],
      projectAttachments: [{ type: 'nomination', name: `Associate ${id}` }],
      votes: 0, userHasVoted: false, status: 'submitted', createdAt: '', updatedAt: '',
    })) })
    const view = render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    try {
      await screen.findByText('Photo nominee 2')
      expect(screen.queryByRole('img', { name: /Associate .* nomination/ })).not.toBeInTheDocument()
      act(() => observers[0].notify(false))
      expect(screen.queryByRole('img', { name: 'Associate 1 nomination' })).not.toBeInTheDocument()
      act(() => observers[1].notify(true))
      const image = screen.getByAltText('Associate 2 nomination')
      expect(image).toHaveAttribute('src', '/photo-2.webp')
      expect(image).toHaveAttribute('decoding', 'async')
      expect(screen.queryByAltText('Associate 1 nomination')).not.toBeInTheDocument()
      fireEvent.error(image)
      expect(screen.getByText('Photo unavailable')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry photo' }))
      const retried = screen.getByAltText('Associate 2 nomination')
      expect(retried).not.toBe(image)
      fireEvent.load(retried)
      expect(retried).toBeVisible()
      expect(screen.queryByText('Photo unavailable')).not.toBeInTheDocument()
      expect(observers[1].disconnect).toHaveBeenCalled()
    } finally {
      view.unmount()
      vi.stubGlobal('IntersectionObserver', originalObserver)
    }
    expect(observers[0].disconnect).toHaveBeenCalled()
  })

  it('uses nomination metadata without requesting an unused creator profile', async () => {
    getIdeas.mockResolvedValueOnce({ content: [{
      id: 'named-nominee', title: 'Named nominee', description: 'Nomination with metadata',
      createdBy: 'creator', category: 'Customer Values', tags: [], attachments: [],
      projectAttachments: [{ type: 'nomination', name: 'Named Associate', nomineeOrgCode: 'BDCN' }],
      votes: 0, userHasVoted: false, status: 'submitted',
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    }] })
    render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    await screen.findByText('Named nominee')
    expect(ProfileService.getProfile).not.toHaveBeenCalled()
  })

  it('shows nominees without exposing internal event concepts', async () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/projects?type=individual"]}>
          <ProjectShowcase />
        </MemoryRouter>
      </MantineProvider>
    )

    expect(await screen.findByText('Customer Portal Renewal')).toBeInTheDocument()
    expect(screen.queryByText('Under Construction')).not.toBeInTheDocument()
    expect(screen.queryByText(/This page is currently under development/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New nomination' })).not.toBeInTheDocument()
    expect(screen.queryByText(/votes available/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Customer Values').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Innovation Breakthrough').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Collaboration To Win').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /All nominees\s*1/ })).toBeInTheDocument()
    expect(screen.queryByText('Spring 2026 Hackathon')).not.toBeInTheDocument()
    expect(screen.queryByText('Winners Only')).not.toBeInTheDocument()
  })

  it('shows nomination details without loading or offering comments', async () => {
    const user = userEvent.setup()
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/projects?type=individual"]}>
          <ProjectShowcase />
        </MemoryRouter>
      </MantineProvider>
    )

    await screen.findByText('Customer Portal Renewal')
    await user.click(screen.getByRole('button', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'Nominee' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument()
    expect(screen.queryByText('The customer impact is well documented.')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).not.toBeInTheDocument()
    expect(getComments).not.toHaveBeenCalled()
  })

  it('requires a track choice before revealing the nomination form', async () => {
    const user = userEvent.setup()
    render(
      <MantineProvider env="test">
        <MemoryRouter initialEntries={["/projects?type=individual"]}>
          <ProjectShowcase nominationMode />
        </MemoryRouter>
      </MantineProvider>
    )

    expect(await screen.findByText('Choose a track to begin')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Award Category/ })).not.toBeInTheDocument()

    const valueTrack = screen.getByRole('radio', { name: /Customer Values/ })
    expect(valueTrack).toHaveAttribute('aria-checked', 'false')
    await user.click(valueTrack)

    expect(valueTrack).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByRole('textbox', { name: /Award Category/ })).toHaveValue('Customer Values')
    expect(screen.queryByRole('textbox', { name: /Contribution title/ })).not.toBeInTheDocument()
    expect(document.getElementById('nomination-track-description')).toHaveTextContent('Customer Impact (40%)')
    await user.type(screen.getByRole('textbox', { name: /Executive Summary/ }), 'Keep this contribution when switching categories.')
    await user.click(screen.getByRole('textbox', { name: 'Award Category' }))
    await user.click(await screen.findByRole('option', { name: 'Collaboration To Win' }))
    expect(screen.getByRole('radio', { name: /Collaboration To Win/ })).toHaveAttribute('aria-checked', 'true')
    expect(document.getElementById('nomination-track-description')).toHaveTextContent('Shared-Goal Ownership (35%)')
    expect(screen.getByRole('textbox', { name: /Executive Summary/ })).toHaveValue('Keep this contribution when switching categories.')
  })

  const renderVoting = (path = '/projects?type=individual') => render(<MantineProvider env="test"><MemoryRouter initialEntries={[path]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
  const mockSubmitted = async () => {
    const page = await getIdeas.getMockImplementation()!()
    getIdeas.mockResolvedValueOnce({ ...page, content: page.content.map((idea) => ({ ...idea, userHasVoted: true, votes: 3 })) })
  }
  it('submits a click immediately and shows only server-confirmed records', async () => {
    renderVoting()
    const vote = await screen.findByRole('button', { name: 'Vote, 2 votes' })
    await mockSubmitted()
    await userEvent.click(vote)
    await waitFor(() => expect(submitVotes).toHaveBeenCalledExactlyOnceWith(['idea-1']))
    expect(await screen.findByRole('button', { name: 'Submitted, 3 votes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit', exact: true })).not.toBeInTheDocument()
    expect(voteIdea).not.toHaveBeenCalled()
  })
  it.each(['Each participant can cast at most 3 votes per award category.', 'At most 2 votes may be cast for projects from your department.', 'Unable to connect.'])('shows a modal and leaves failed votes unsubmitted: %s', async (message) => {
    submitVotes.mockRejectedValueOnce(new Error(message))
    renderVoting()
    await userEvent.click(await screen.findByRole('button', { name: 'Vote, 2 votes' }))
    expect(await screen.findByRole('dialog', { name: 'Vote Not Submitted' })).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Vote, 2 votes' })).toBeInTheDocument()
  })
  it('cancels a submitted vote on the next click and synchronizes the cart', async () => {
    renderVoting()
    const vote = await screen.findByRole('button', { name: 'Vote, 2 votes' })
    await mockSubmitted()
    await userEvent.click(vote)
    const submitted = await screen.findByRole('button', { name: 'Submitted, 3 votes' })
    await waitFor(() => expect(submitted).toBeEnabled())
    expect(screen.getByRole('button', { name: 'My votes (1)' })).toBeInTheDocument()
    await userEvent.click(submitted)
    await waitFor(() => expect(deleteVoteRecord).toHaveBeenCalledExactlyOnceWith('idea-1'))
    expect(await screen.findByRole('button', { name: 'Vote, 2 votes' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'My votes (0)' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Delete Voting Record?' })).not.toBeInTheDocument()
  })
  it('keeps a submitted vote in the cart if cancellation fails', async () => {
    await mockSubmitted()
    deleteVoteRecord.mockRejectedValueOnce(new Error('Cancellation failed.'))
    renderVoting()
    await userEvent.click(await screen.findByRole('button', { name: 'Submitted, 3 votes' }))
    expect(await screen.findByRole('dialog', { name: 'Vote Not Submitted' })).toHaveTextContent('Cancellation failed.')
    expect(screen.getByRole('button', { name: 'My votes (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submitted, 3 votes' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('counts only the selected type while keeping votes independent of search and other types', async () => {
    const page = await getIdeas.getMockImplementation()!()
    const base = page.content[0]
    const content = [
      { ...base, id: 'individual-saved', title: 'Individual saved', userHasVoted: true },
      { ...base, id: 'individual-new', title: 'Individual new', userHasVoted: false },
      { ...base, id: 'team-one', title: 'Team one', teamId: 'team-1', userHasVoted: true },
      { ...base, id: 'team-two', title: 'Team two', teamId: 'team-1', userHasVoted: true },
      { ...base, id: 'team-new', title: 'Team new', teamId: 'team-1', userHasVoted: false },
    ]
    getIdeas.mockResolvedValueOnce({ ...page, content })
    renderVoting('/projects?type=team')
    expect(await screen.findByRole('button', { name: 'My votes (2)' })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Individual', exact: true }))
    expect(screen.getByRole('button', { name: 'My votes (1)' })).toHaveTextContent('1')
    const search = screen.getByPlaceholderText(/Search/)
    await userEvent.type(search, 'no match')
    expect(screen.getByRole('button', { name: 'My votes (1)' })).toHaveTextContent('1')
    await userEvent.clear(search)
    getIdeas.mockResolvedValueOnce({ ...page, content: content.map((idea) => idea.id === 'individual-new' ? { ...idea, userHasVoted: true, votes: 3 } : idea) })
    await userEvent.click(screen.getByRole('button', { name: 'Vote, 2 votes' }))
    const submitted = await screen.findByRole('button', { name: 'Submitted, 3 votes' })
    await waitFor(() => expect(submitted).toBeEnabled())
    expect(submitVotes).toHaveBeenCalledExactlyOnceWith(['individual-new'])
    expect(screen.getByRole('button', { name: 'My votes (2)' })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Team', exact: true }))
    expect(screen.getByRole('button', { name: 'My votes (2)' })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Individual', exact: true }))
    getIdeas.mockResolvedValueOnce({ ...page, content })
    await userEvent.click(screen.getByRole('button', { name: 'Submitted, 3 votes' }))
    await waitFor(() => expect(deleteVoteRecord).toHaveBeenCalledExactlyOnceWith('individual-new'))
    expect(await screen.findByRole('button', { name: 'My votes (1)' })).toHaveTextContent('1')
    await userEvent.click(screen.getByRole('button', { name: 'Team', exact: true }))
    expect(screen.getByRole('button', { name: 'My votes (2)' })).toHaveTextContent('2')
  })
  it('locates a cart nominee across type and search filters without opening details', async () => {
    await mockSubmitted()
    renderVoting('/projects?type=team')
    const cart = await screen.findByRole('button', { name: 'My votes (0)' })
    const search = screen.getByPlaceholderText(/Search/)
    await userEvent.type(search, 'no match')
    await userEvent.click(cart)
    await userEvent.click(screen.getByRole('button', { name: 'Locate Customer Portal Renewal' }))
    expect(screen.getByRole('button', { name: 'Individual', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(search).toHaveValue('')
    await waitFor(() => expect(document.getElementById('nominee-card-idea-1')).toHaveFocus())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Nomination details' })).not.toBeInTheDocument()
  })
  it('sends only one request for repeated clicks while saving', async () => {
    let resolve!: () => void
    submitVotes.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    renderVoting()
    const vote = await screen.findByRole('button', { name: 'Vote, 2 votes' })
    fireEvent.click(vote); fireEvent.click(vote)
    expect(submitVotes).toHaveBeenCalledTimes(1)
    expect(vote).toBeDisabled()
    await mockSubmitted(); await act(async () => resolve())
  })
  it('defaults to Team and can switch to Individual', async () => {
    renderVoting('/projects')
    expect(screen.getByRole('button', {name:'Team', exact:true})).toHaveAttribute('aria-pressed','true')
    await waitFor(() => expect(getIdeas).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', {name:'Individual', exact:true}))
    expect(await screen.findByText('Customer Portal Renewal')).toBeInTheDocument()
  })
  it('requires irreversible deletion confirmation, supports cancel and retry, and allows a new selection', async () => {
    await mockSubmitted()
    renderVoting('/projects?view=voting-records&type=individual')
    const records = await screen.findByRole('dialog', { name: 'My Voting Records' }, { timeout: 2500 })
    const remove = await within(records).findByRole('button', { name: 'Delete voting record for Customer Portal Renewal' })
    await userEvent.click(remove)
    let confirmation = await screen.findByRole('dialog', { name: 'Delete Voting Record?' })
    expect(within(confirmation).getByText(/This action cannot be undone/)).toBeInTheDocument()
    expect(deleteVoteRecord).not.toHaveBeenCalled()
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
    expect(within(records).getByText('Customer Portal Renewal')).toBeInTheDocument()
    await userEvent.click(remove)
    confirmation = await screen.findByRole('dialog', { name: 'Delete Voting Record?' })
    deleteVoteRecord.mockRejectedValueOnce(new Error('Please try again.'))
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Delete permanently' }))
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Please try again.')
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Delete permanently' }))
    expect(deleteVoteRecord).toHaveBeenLastCalledWith('idea-1')
    expect(await within(records).findByText('No submitted votes yet.')).toBeInTheDocument()
    await userEvent.click(within(records).getByRole('button', { name: 'Back to nominees' }))
    await mockSubmitted()
    await userEvent.click(await screen.findByRole('button', { name: 'Vote, 2 votes' }))
    expect(screen.getByRole('button', { name: 'My votes (1)' })).toBeInTheDocument()
  })

  it('splits legacy combined tags into separate, deduplicated badges', async () => {
    getIdeas.mockResolvedValueOnce({ content: [{
      id: 'idea-1', title: 'Legacy tags', description: 'Combined tags', teamId: null,
      createdBy: 'user-1', category: 'AI', tags: ['IoT、Digital Twin，Cloud、IoT、'],
      attachments: [], projectAttachments: [], votes: 0, userHasVoted: false,
      status: 'submitted', createdAt: '', updatedAt: '',
    }] })
    render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    await screen.findByText('Legacy tags')
    const tags = document.querySelector('.dp-nomination-tags') as HTMLElement
    expect(within(tags).getByText('IoT')).toBeInTheDocument()
    expect(within(tags).getByText('Digital Twin')).toBeInTheDocument()
    expect(within(tags).getByText('Cloud')).toBeInTheDocument()
    expect(within(tags).getAllByText('IoT')).toHaveLength(1)
  })

  it('previews only the summary and keeps all answers in the detail dialog', async () => {
    getIdeas.mockResolvedValueOnce({ content: [{
      id: 'idea-1', title: 'Nominee Name', teamId: null, createdBy: 'user-1',
      description: 'Executive Summary\nSummary first paragraph.\n\nSummary second paragraph.\n\nDetails of Your Core Achievement in 2026 and Business Impact (including financial figures)\nSaved RMB 200,000.\n\nHow You Demonstrate Bosch China Culture (Especially in Your Applied Category)\nWorked across departments.',
      category: 'AI', tags: ['Impact'], attachments: [], projectAttachments: [{ type: 'nomination', name: 'Nominee Name', nomineeOrgCode: 'HRL-CN C/HRR-JMPCN' }],
      votes: 0, userHasVoted: false, status: 'submitted', createdAt: '', updatedAt: '',
    }] })
    render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    await screen.findByText('Nominee Name')
    const card = document.querySelector('.dp-project-card') as HTMLElement
    expect(within(card).getByText(/Summary first paragraph/)).toHaveTextContent('Summary second paragraph.')
    expect(within(card).queryByText(/Saved RMB/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Worked across departments/)).not.toBeInTheDocument()
    expect(within(card).queryByText('Department')).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'View details' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByText('Department')).not.toBeInTheDocument()
    expect(dialog.getByText('Org. Code').parentElement).toHaveTextContent('HRL-CN C/HRR-JMPCN')
    expect(dialog.getByRole('heading', { name: 'Executive Summary (The Elevator Pitch)' })).toBeInTheDocument()
    expect(dialog.getByRole('heading', { name: /Details Of Your Core Achievement/ })).toBeInTheDocument()
    expect(dialog.getByRole('heading', { name: /How You Demonstrate BD China Culture/ })).toBeInTheDocument()
    for (const answer of ['Summary first paragraph.', 'Summary second paragraph.', 'Saved RMB 200,000.', 'Worked across departments.']) {
      expect(dialog.getByText(answer)).toBeInTheDocument()
    }
  })

  it('shows legacy team answers under title-case headings and opens its PDF only on request', async () => {
    getIdeas.mockResolvedValueOnce({ content: [{
      id: 'team-detail', title: 'Original Team Name', teamId: null, createdBy: 'user-1',
      description: '**Achievement Summary**\nTeam summary in original case.\n\nDetails of Your Team Achievement in 2026 and Business Impact\nSaved RMB 300,000.\n\nHow you demonstrate BD China culture (especially on you applied category) ?\nWorked with other teams.',
      category: 'Customer Values', tags: ['Hidden team tag'], attachments: [],
      projectAttachments: [
        { type: 'nomination', nominationType: 'team', name: 'Original Team Name' },
        { type: 'document', name: 'Team evidence.pdf', storageKey: 'team/evidence.pdf', url: '/expired.pdf' },
      ],
      votes: 0, userHasVoted: false, status: 'submitted', createdAt: '', updatedAt: '',
    }] })
    vi.mocked(StorageService.getPresignedUrl).mockResolvedValue('/storage/team-evidence.pdf')
    render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=team"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
    await screen.findByText('Original Team Name')
    await userEvent.click(screen.getByRole('button', { name: 'View details' }))
    const dialog = within(screen.getByRole('dialog'))
    for (const heading of ['Achievement Summary', 'Details Of Your Team Achievement In 2026 And Business Impact', 'How You Demonstrate BD China Culture']) {
      expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeInTheDocument()
    }
    for (const answer of ['Team summary in original case.', 'Saved RMB 300,000.', 'Worked with other teams.']) {
      expect(dialog.getByText(answer, { exact: true })).toBeInTheDocument()
    }
    expect(dialog.queryByRole('heading', { name: 'Tags' })).not.toBeInTheDocument()
    expect(dialog.getByText('Team evidence.pdf')).toBeInTheDocument()
    expect(dialog.queryByTitle('PDF preview: Team evidence.pdf')).not.toBeInTheDocument()
    expect(StorageService.getPresignedUrl).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Preview Attachment' }))
    expect(await dialog.findByTitle('PDF preview: Team evidence.pdf')).toHaveAttribute('src', '/storage/team-evidence.pdf')
    await userEvent.click(dialog.getByRole('button', { name: 'Hide Attachment' }))
    expect(dialog.queryByTitle('PDF preview: Team evidence.pdf')).not.toBeInTheDocument()
    expect(dialog.getByText('Saved RMB 300,000.')).toBeInTheDocument()
  })

  it('presents nomination as an individual three-track flow without team controls', async () => {
    const user = userEvent.setup()
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/projects?type=individual"]}>
          <ProjectShowcase nominationMode />
        </MemoryRouter>
      </MantineProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Start You Nomation' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Nominate a Digital Pioneer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Executive Summary/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Innovation Breakthrough/ }))
    expect(screen.getByRole('textbox', { name: /Executive Summary \(The Elevator Pitch\)/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Details Of Your Core Achievement In 2026 And Business Impact/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /How You Demonstrate BD China Culture/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Tags You Want To Add/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Award Category/ })).toHaveValue('Innovation Breakthrough')
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Team', exact: true })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('textbox', { name: 'Team name' })).not.toBeInTheDocument()
    expect(screen.queryByText('Customer Portal Renewal')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Award event' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Position/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Nominating HoD/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Supporting evidence URL/ })).not.toBeInTheDocument()
  })

  it.each(['admin', 'manager', 'participant'] as const)('fixes the nominee to the signed-in %s name and email', async (role) => {
    currentUser.role = role
    try {
      const user = userEvent.setup()
      render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
      await user.click(await screen.findByRole('radio', { name: /Customer Values/ }))
      const nominee = await screen.findByRole('textbox', { name: /Outlook Name/ })
      expect(nominee).toHaveAttribute('readonly')
      expect(nominee).toHaveValue('user@example.com')
      await user.type(nominee, 'Named')
      expect(nominee).toHaveValue('user@example.com')
      expect(listNominees).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: /Award Category/ })).toHaveValue('Customer Values')
    } finally {
      currentUser.role = 'participant'
    }
  })

  it('resubmits the rejected employee record with its version and retained photo', async () => {
    currentUser.role = 'participant'
    vi.mocked(StorageService.getPresignedUrl).mockResolvedValueOnce('/storage/retained-photo.png')
    removeDraft.mockRejectedValueOnce(new Error('Draft storage unavailable'))
    getIdea.mockResolvedValueOnce({
      id: 'rejected-1', createdBy: 'user-1', hackathonId: 'hackathon-1', category: 'Customer Values',
      description: 'Executive Summary\nOriginal summary\n\nDetails of Your Core Achievement in 2026 and Business Impact (including financial figures)\nOriginal impact\n\nHow You Demonstrate Bosch China Culture (Especially in Your Applied Category)\nOriginal culture',
      tags: ['Original tag'], approvalStatus: 'rejected', approvalVersion: 4,
      approvalReason: 'Explain the measured savings.',
      projectAttachments: [{ type: 'screenshot', url: '/existing-photo.png', name: 'existing-photo.png', storageKey: 'nominations/hackathon-1/user-1/existing-photo.png' }],
    })
    updateIdea.mockResolvedValueOnce({ id: 'rejected-1', category: 'Customer Values', approvalStatus: 'pending' })
    const user = userEvent.setup()
    render(<MantineProvider env="test"><MemoryRouter initialEntries={['/nominate?edit=rejected-1']}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    const impact = await screen.findByRole('textbox', { name: /Details Of Your Core Achievement/ })
    expect(impact).toHaveValue('Original impact')
    expect(screen.getByText('Explain the measured savings.')).toBeInTheDocument()
    await user.clear(impact)
    await user.type(impact, 'Measured savings from the submitted report.')
    await user.click(screen.getByRole('button', { name: 'Resubmit nomination' }))
    expect(updateIdea).not.toHaveBeenCalled()
    const review = await screen.findByRole('dialog', { name: 'Review Individual Nomination' })
    expect(within(review).getByText('Measured savings from the submitted report.')).toBeInTheDocument()
    expect(await within(review).findByRole('img', { name: 'Retained Nomination Photo' })).toHaveAttribute('src', '/storage/retained-photo.png')
    await user.click(within(review).getByRole('button', { name: 'Confirm And Submit' }))
    await waitFor(() => expect(updateIdea).toHaveBeenCalledWith('rejected-1', expect.objectContaining({
      approvalVersion: 4,
      description: expect.stringContaining('Measured savings from the submitted report.'),
      projectAttachments: expect.arrayContaining([expect.objectContaining({ storageKey: 'nominations/hackathon-1/user-1/existing-photo.png' })]),
    })))
    expect(createIdea).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Nomination Submitted Successfully' })).toBeInTheDocument()
    expect(screen.queryByText(/^Number:/)).not.toBeInTheDocument()
    expect(await screen.findByText(/Your nomination was submitted, but its saved draft could not be removed/)).toBeInTheDocument()
  })

  it('keeps team submission successful and displays a warning when its draft cannot be removed', async () => {
    removeDraft.mockRejectedValueOnce(new Error('Draft storage unavailable'))
    getIdea.mockResolvedValueOnce({
      id: 'rejected-team', createdBy: 'user-1', hackathonId: 'hackathon-1', category: 'Customer Values',
      description: 'Saved team details', tags: [], approvalStatus: 'rejected', approvalVersion: 4,
      projectAttachments: [
        { type: 'nomination', nominationType: 'team', name: 'Saved project', projectName: 'Saved project', coreTeamMembers: 'Member One;Member Two', achievementSummary: 'Saved summary', teamAchievementImpact: 'Saved impact', cultureDemonstration: 'Saved culture' },
        { type: 'screenshot', url: '/storage/team.png', name: 'team.png' },
      ],
    })
    updateIdea.mockResolvedValueOnce({ id: 'rejected-team', category: 'Customer Values', approvalStatus: 'pending' })
    const user = userEvent.setup()
    render(<MantineProvider env="test"><MemoryRouter initialEntries={['/nominate?edit=rejected-team']}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    await user.click(await screen.findByRole('button', { name: 'Resubmit nomination' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm And Submit' }))
    expect(await screen.findByRole('heading', { name: 'Nomination Submitted Successfully' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your nomination was submitted, but its saved draft could not be removed.')
    expect(updateIdea).toHaveBeenCalledOnce()
    expect(createIdea).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(removeDraft).toHaveBeenCalledWith('["user-1","hackathon-1","team","rejected-team"]')
  })

  it('restores a saved individual draft with files, previews before submitting and removes it only after success', async () => {
    const photo = new File(['photo'], 'saved-photo.png', { type: 'image/png' })
    const documentFile = new File(['%PDF-1.7'], 'saved-evidence.pdf', { type: 'application/pdf' })
    const data = {
      form: { hackathonId: 'hackathon-1', category: 'Customer Values', executiveSummary: 'Saved summary', achievementImpact: 'Saved impact', cultureDemonstration: 'Saved culture', technologies: 'Customer' },
      photo, document: documentFile,
    }
    loadDraft.mockResolvedValueOnce({ version: 1, savedAt: '2026-11-09T00:00:00Z', data })
    const user = userEvent.setup()
    render(<MantineProvider env="test"><MemoryRouter initialEntries={['/nominate?type=individual']}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    const restore = await screen.findByRole('button', { name: 'Restore Draft' })
    expect(screen.queryByRole('textbox', { name: /Executive Summary/ })).not.toBeInTheDocument()
    await user.click(restore)
    expect(await screen.findByRole('textbox', { name: /Executive Summary/ })).toHaveValue('Saved summary')
    expect(screen.getByRole('textbox', { name: /Award Category/ })).toHaveValue('Customer Values')
    expect(screen.queryByTitle('Selected PDF preview: saved-evidence.pdf')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith('["user-1","hackathon-1","individual","new"]', expect.objectContaining({ form: data.form, photo, document: documentFile })))
    await user.click(screen.getByRole('button', { name: 'Submit nomination' }))
    const review = await screen.findByRole('dialog', { name: 'Review Individual Nomination' })
    expect(createIdea).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(removeDraft).not.toHaveBeenCalled()
    expect(within(review).getByText('Saved summary')).toBeInTheDocument()
    expect(within(review).getByText('saved-evidence.pdf')).toBeInTheDocument()
    expect(within(review).queryByTitle('Selected PDF preview: saved-evidence.pdf')).not.toBeInTheDocument()
    await user.click(within(review).getByRole('button', { name: 'Preview Attachment' }))
    expect(await within(review).findByTitle('Selected PDF preview: saved-evidence.pdf')).toBeInTheDocument()
    expect(within(review).getByText('Saved impact')).toBeInTheDocument()
    await user.click(within(review).getByRole('button', { name: 'Back To Edit' }))
    expect(screen.getByRole('textbox', { name: /Executive Summary/ })).toHaveValue('Saved summary')
    await user.click(screen.getByRole('button', { name: 'Submit nomination' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Review Individual Nomination' })).getByRole('button', { name: 'Confirm And Submit' }))
    await waitFor(() => expect(createIdea).toHaveBeenCalledTimes(1))
    expect(uploadFile).toHaveBeenCalledWith(documentFile, 'project-attachments', 'nominations/hackathon-1/user-1')
    expect(removeDraft).toHaveBeenCalledWith('["user-1","hackathon-1","individual","new"]')
  })

  it('saves an incomplete form without uploading or submitting and reports storage failures', async () => {
    saveDraft.mockRejectedValueOnce(new Error('Quota exceeded'))
    const user = userEvent.setup()
    render(<MantineProvider env="test"><MemoryRouter initialEntries={['/nominate?type=individual']}><ProjectShowcase nominationMode /></MemoryRouter></MantineProvider>)
    await user.click(await screen.findByRole('radio', { name: /Customer Values/ }))
    await user.type(await screen.findByRole('textbox', { name: /Executive Summary/ }), 'A partial summary')
    await user.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(await screen.findByText('Unable to save the draft. Keep this page open and try again.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Executive Summary/ })).toHaveValue('A partial summary')
    expect(createIdea).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it.each(['image/webp', 'image/png'])('submits a cropped %s photo in a draft award without creating a team', async (outputType) => {
    currentUser.role = 'admin'
    getHackathons.mockResolvedValueOnce({ content: [{ id: 'hackathon-1', title: '2026 Award', status: 'draft' }] })
    const user = userEvent.setup()
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/projects?type=individual"]}>
          <ProjectShowcase nominationMode />
        </MemoryRouter>
      </MantineProvider>
    )

    await user.click(await screen.findByRole('radio', { name: /Customer Values/ }))
    await user.type(screen.getByRole('textbox', { name: /Executive Summary/ }), 'A better customer experience in four clear sentences.')
    await user.type(screen.getByRole('textbox', { name: /Details Of Your Core Achievement In 2026 And Business Impact/ }), 'Reduced service time by 30% and saved RMB 200,000.')
    await user.type(screen.getByRole('textbox', { name: /How You Demonstrate BD China Culture/ }), 'Listened to users and delivered an end-to-end solution.')
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const oversized = new File(['image'], 'large.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 })
    await user.upload(fileInput!, oversized)
    expect(screen.getByText('Photo exceeds 50 MB. Please choose a smaller photo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeDisabled()
    expect(uploadFile).not.toHaveBeenCalled()
    await user.upload(fileInput!, new File(['image'], 'project.png', { type: 'image/png' }))
    const cropImage = await screen.findByRole('img', { name: 'Photo to crop' })
    Object.defineProperties(cropImage, { naturalWidth: { value: 1200 }, naturalHeight: { value: 1600 } })
    const drawImage = vi.fn()
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['cropped image'], { type: outputType })))
    try {
      fireEvent.load(cropImage)
      await user.click(screen.getByRole('button', { name: 'Confirm crop' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm crop' })).not.toBeInTheDocument())
      expect(drawImage).toHaveBeenCalled()
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.85)
    } finally {
      context.mockRestore()
      toBlob.mockRestore()
    }
    expect(screen.queryByText('Photo exceeds 50 MB. Please choose a smaller photo.')).not.toBeInTheDocument()
    const tagsInput = screen.getByRole('textbox', { name: /Tags You Want To Add/ })
    await user.type(tagsInput, 'Customer、Innovation，Collaboration, Impact、Digital、Sixth、')
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeDisabled()
    expect(createIdea).not.toHaveBeenCalled()
    await user.clear(tagsInput)
    await user.type(tagsInput, 'Customer，Innovation、Collaboration, Impact、Digital、Customer、')
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Submit nomination' }))
    const review = await screen.findByRole('dialog', { name: 'Review Individual Nomination' })
    expect(createIdea).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(within(review).getByText('Reduced service time by 30% and saved RMB 200,000.')).toBeInTheDocument()
    await user.click(within(review).getByRole('button', { name: 'Confirm And Submit' }))

    await waitFor(() => expect(createIdea).toHaveBeenCalled())
    expect(getOrCreateNominationTeam).not.toHaveBeenCalled()
    expect(createTeam).not.toHaveBeenCalled()
    expect(createIdea.mock.calls[0][0]).not.toHaveProperty('teamId')
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ type: outputType, name: `project-cropped.${outputType === 'image/webp' ? 'webp' : 'png'}` }), 'project-attachments', 'nominations/hackathon-1/user-1')
    expect(createIdea).toHaveBeenCalledWith(expect.objectContaining({
      hackathonId: 'hackathon-1',
      category: 'Customer Values',
      tags: ['Customer', 'Innovation', 'Collaboration', 'Impact', 'Digital'],
      title: 'User',
    }))
    expect(createIdea).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      projectAttachments: expect.arrayContaining([expect.objectContaining({ type: 'nomination', nomineeUserId: 'user-1', name: 'User' })]),
    }))
    expect(createIdea).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('Details of Your Core Achievement in 2026 and Business Impact (including financial figures)'),
    }))
    expect(createIdea).toHaveBeenCalledTimes(1)
    expect(updateIdea).not.toHaveBeenCalled()
    expect(uploadFile.mock.invocationCallOrder[0]).toBeLessThan(createIdea.mock.invocationCallOrder[0])
  })
})


describe('Nominee deletion', () => {
  afterEach(() => { currentUser.role = 'participant'; vi.clearAllMocks() })

  function renderManagement() {
    return render(<MantineProvider><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase managementMode /></MemoryRouter></MantineProvider>)
  }

  it.each(['participant', 'manager'] as const)('does not expose deletion to %s', async (role) => {
    currentUser.role = role
    renderManagement()
    await screen.findByText('Customer Portal Renewal')
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('requires confirmation, allows cancellation, then removes a committed deletion and updates counts', async () => {
    currentUser.role = 'admin'
    renderManagement()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Customer Portal Renewal' }))
    let dialog = await screen.findByRole('dialog', { name: 'Confirm Nomination Deletion' })
    expect(deleteIdea).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Customer Portal Renewal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Customer Portal Renewal' }))
    dialog = await screen.findByRole('dialog', { name: 'Confirm Nomination Deletion' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.queryByText('Customer Portal Renewal')).not.toBeInTheDocument())
    expect(deleteIdea).toHaveBeenCalledExactlyOnceWith('idea-1')
    expect(screen.getByRole('button', { name: /All nominees\s*0/ })).toBeInTheDocument()
  })

  it.each(['selected', 'all'])('deletes %s nominations in one batch after confirmation', async (mode) => {
    currentUser.role = 'admin'
    const original = await getIdeas()
    getIdeas.mockResolvedValueOnce({ content: [original.content[0], { ...original.content[0], id: 'idea-2', title: 'Second nomination' }] })
    renderManagement()
    await screen.findByText('Second nomination')
    if (mode === 'selected') await userEvent.click(screen.getByRole('checkbox', { name: 'Select all results (2)' }))
    await userEvent.click(screen.getByRole('button', { name: mode === 'selected' ? 'Delete selected (2)' : 'Delete all (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm Nomination Deletion' })
    expect(deleteIdeas).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.queryByText('Second nomination')).not.toBeInTheDocument())
    expect(deleteIdeas).toHaveBeenCalledExactlyOnceWith(['idea-1', 'idea-2'])
    expect(screen.getByRole('button', { name: 'Delete all (0)' })).toBeDisabled()
  })

  it('preserves nominations and selection on failure and allows retry', async () => {
    currentUser.role = 'admin'
    deleteIdea.mockRejectedValueOnce(new Error('Deletion failed'))
    renderManagement()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Customer Portal Renewal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm Nomination Deletion' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Deletion failed')
    expect(screen.getByRole('checkbox', { name: 'Select Customer Portal Renewal' })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.queryByText('Customer Portal Renewal')).not.toBeInTheDocument())
    expect(deleteIdea).toHaveBeenCalledTimes(2)
  })
})

it('renders nomination text and voting controls before a slow photo URL resolves', async () => {
  let resolvePhoto!: (url: string) => void
  vi.mocked(StorageService.getPresignedUrl).mockImplementationOnce(() => new Promise((resolve) => { resolvePhoto = resolve }))
  getIdeas.mockResolvedValueOnce({ content: [{
    id: 'slow-photo', title: 'Slow photo nominee', description: 'Ready to vote', createdBy: 'creator',
    category: 'Customer Values', tags: [], attachments: [],
    projectAttachments: [{ type: 'nomination', name: 'Associate' }, { type: 'screenshot', storageKey: 'slow', url: '/fallback.jpg' }],
    votes: 0, userHasVoted: false, status: 'submitted', createdAt: '', updatedAt: '',
  }] })
  render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
  expect(await screen.findByText('Slow photo nominee')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Vote, 0 votes' })).toBeEnabled()
  expect(screen.queryByAltText('Associate nomination')).not.toBeInTheDocument()
  await act(async () => resolvePhoto('/resolved.jpg'))
  await waitFor(() => expect(screen.getByAltText('Associate nomination')).toHaveAttribute('src', '/resolved.jpg'))
})

it('shows a ready photo without waiting for another nominee photo', async () => {
  let resolveSlow!: (url: string) => void
  vi.mocked(StorageService.getPresignedUrl).mockImplementation((_bucket, key) => key === 'slow'
    ? new Promise((resolve) => { resolveSlow = resolve }) : Promise.resolve('/fast.jpg'))
  getIdeas.mockResolvedValueOnce({ content: ['slow', 'fast'].map((key) => ({
    id: key, title: `${key} nominee`, description: 'Ready to vote', createdBy: 'creator',
    category: 'Customer Values', tags: [], attachments: [],
    projectAttachments: [{ type: 'nomination', name: key }, { type: 'screenshot', storageKey: key, url: '/fallback.jpg' }],
    votes: 0, userHasVoted: false, status: 'submitted', createdAt: '', updatedAt: '',
  })) })
  render(<MantineProvider env="test"><MemoryRouter initialEntries={["/projects?type=individual"]}><ProjectShowcase /></MemoryRouter></MantineProvider>)
  try {
    expect(await screen.findByAltText('fast nomination')).toHaveAttribute('src', '/fast.jpg')
    expect(screen.queryByAltText('slow nomination')).not.toBeInTheDocument()
  } finally {
    await act(async () => resolveSlow('/slow.jpg'))
  }
})
