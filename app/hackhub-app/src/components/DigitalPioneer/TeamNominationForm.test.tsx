import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamNominationForm } from './TeamNominationForm'
import { TeamService, type Team, type TeamMember } from '../../services/teamService'
import { IdeaService, type Idea } from '../../services/ideaService'
import { StorageService } from '../../services/storageService'
import { TeamMemberService } from '../../services/teamMemberService'
import { NominationDraftStore, nominationDraftKey } from '../../services/nominationDraftStore'

vi.mock('../../services/nominationDraftStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/nominationDraftStore')>(),
  NominationDraftStore: { load: vi.fn(), save: vi.fn(), remove: vi.fn() },
}))

vi.mock('../../services/teamMemberService', () => ({ TeamMemberService: { search: vi.fn() } }))
vi.mock('../../services/teamService', () => ({ TeamService: { getTeams: vi.fn(), getMyTeams: vi.fn(), createTeam: vi.fn(), joinTeam: vi.fn() } }))
vi.mock('../../services/ideaService', () => ({ IdeaService: { createIdea: vi.fn(), updateIdea: vi.fn() } }))
vi.mock('../../services/storageService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/storageService')>(),
  StorageService: { uploadFile: vi.fn(), getPresignedUrl: vi.fn() },
}))
const user = { id: 'captain', name: 'Signed-in Captain', email: 'captain@example.com', role: 'participant' as const, skills: [] }
const team: Team = { id: 'team', name: 'Created team', description: '', hackathonId: 'campaign', createdBy: user.id, isOpen: true, skills: [], avatarUrl: null, createdAt: '', updatedAt: '' }
const member: TeamMember = { id: 'membership', teamId: undefined, userId: user.id, role: 'leader', joinedAt: '' }
const existing = {
  id: 'rejected', createdBy: user.id, teamId: undefined, hackathonId: 'campaign', category: 'customer-values', approvalStatus: 'rejected', approvalVersion: 4,
  projectAttachments: [
    { type: 'nomination', nominationType: 'team', url: '', name: 'Real project', projectName: 'Real project', coreTeamMembers: 'Actual Member;Another Member', achievementSummary: 'Actual submitted summary', teamAchievementImpact: 'Actual impact', cultureDemonstration: 'Actual culture', nominatorName: 'Saved nominator' },
    { type: 'screenshot', name: 'team.png', storageKey: 'nominations/campaign/captain/team.png', url: '/original-photo' },
    { type: 'document', name: 'evidence.pdf', storageKey: 'nominations/campaign/captain/evidence.pdf', url: '/original-document' },
  ],
} as Idea
Element.prototype.scrollIntoView = vi.fn()
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const onSubmitted = vi.fn()
function show(editing?: Idea) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MantineProvider env="test"><QueryClientProvider client={client}><TeamNominationForm user={user}
    hackathonId="campaign" category="customer-values" onCategoryChange={vi.fn()} canSubmit editing={editing} onSubmitted={onSubmitted} />
  </QueryClientProvider></MantineProvider>)
}
async function fill(view: ReturnType<typeof show>, summary = 'Test-only achievement summary') {
  await screen.findByRole('textbox', { name: /Project Name/ })
  fireEvent.change(screen.getByRole('textbox', { name: /Project Name/ }), { target: { value: 'Test project' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Core Team Member/ }), { target: { value: 'Member One;Member Two' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Achievement Summary/ }), { target: { value: summary } })
  fireEvent.change(screen.getByRole('textbox', { name: /Details of Your Team/ }), { target: { value: 'Measurable test impact' } })
  fireEvent.change(screen.getByRole('textbox', { name: /How You Demonstrate/i }), { target: { value: 'Test culture evidence' } })
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['photo'], 'team.png', { type: 'image/png' })] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(NominationDraftStore.load).mockResolvedValue(null)
  vi.mocked(NominationDraftStore.save).mockImplementation(async (_key, data) => ({ version: 1, savedAt: '2026-11-09T10:00:00.000Z', data }))
  vi.mocked(NominationDraftStore.remove).mockResolvedValue(undefined)
  vi.mocked(TeamMemberService.search).mockResolvedValue([])
  vi.mocked(TeamService.getTeams).mockResolvedValue([team])
  vi.mocked(TeamService.getMyTeams).mockResolvedValue([member])
  vi.mocked(StorageService.uploadFile).mockResolvedValue({ url: '/uploaded-photo', key: 'nominations/campaign/captain/upload.png' })
  vi.mocked(StorageService.getPresignedUrl).mockResolvedValue('/signed-photo')
  vi.mocked(IdeaService.createIdea).mockResolvedValue({ id: 'submitted' } as Idea)
  vi.mocked(IdeaService.updateIdea).mockResolvedValue({ id: existing.id } as Idea)
  URL.createObjectURL = vi.fn().mockReturnValue('blob:team-photo')
  URL.revokeObjectURL = vi.fn()
})

describe('Team nomination form', () => {
  it('opens the fields directly without separate team creation', async () => { show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled()); expect(screen.getByRole('textbox', {name:'Project Name'})).toBeInTheDocument(); expect(screen.queryByRole('button', {name:'Create team'})).not.toBeInTheDocument(); expect(TeamService.getMyTeams).not.toHaveBeenCalled(); })


  it('submits the captain’s actual structured fields and original team photo without cropping', async () => {
    const view = show()
    await fill(view)
    expect(screen.getByRole('textbox', { name: 'Nominator Name' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'Nominator Name' })).toHaveValue(user.name)
    expect(screen.getByPlaceholderText(/Only BDCN team employees/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }))
    expect(await screen.findByRole('dialog', { name: 'Review Team Nomination' })).toHaveTextContent('Measurable test impact')
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm And Submit' }))
    await waitFor(() => expect(IdeaService.createIdea).toHaveBeenCalledOnce())
    expect(StorageService.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'team.png' }), 'project-attachments', 'nominations/campaign/captain')
    expect(IdeaService.createIdea).toHaveBeenCalledWith(expect.objectContaining({ teamId: undefined,
      projectAttachments: expect.arrayContaining([expect.objectContaining({ nominationType: 'team', projectName: 'Test project', coreTeamMembers: 'Member One;Member Two', achievementSummary: 'Test-only achievement summary', teamAchievementImpact: 'Measurable test impact', cultureDemonstration: 'Test culture evidence' })]),
    }))
    expect(TeamService.createTeam).not.toHaveBeenCalled()
    expect(NominationDraftStore.remove).toHaveBeenCalledWith(nominationDraftKey({ userId: user.id, hackathonId: 'campaign', nominationType: 'team' }))
  })
  it('blocks a summary over 200 words before uploading or submitting', async () => {
    const view = show()
    await fill(view, Array.from({ length: 201 }, () => 'word').join(' '))
    expect(screen.getByText('Maximum 200 words.')).toBeInTheDocument()
    expect(screen.queryByText(/\d+ \/ 200 words/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeDisabled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
  })
  it('blocks empty names and incorrect member delimiters', async () => {
    const view = show()
    await fill(view)
    fireEvent.change(screen.getByRole('textbox', { name: /Core Team Member/ }), { target: { value: 'Member One;;Member Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }))
    await screen.findByText(/without empty names/)
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })
  it('preloads rejected fields and preserves original photo/document and approval version when resubmitting', async () => {
    show(existing)
    await screen.findByRole('textbox', { name: /Project Name/ })
    expect(screen.getByRole('textbox', { name: /Project Name/ })).toHaveValue('Real project')
    expect(screen.getByRole('textbox', { name: /Achievement Summary/ })).toHaveValue('Actual submitted summary')
    expect(screen.getByRole('textbox', { name: 'Nominator Name' })).toHaveValue('Saved nominator')
    expect(screen.getByText('Retained attachment: evidence.pdf')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Achievement Summary/ }), { target: { value: 'Revised actual summary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit nomination' }))
    expect(IdeaService.updateIdea).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm And Submit' }))
    await waitFor(() => expect(IdeaService.updateIdea).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      approvalVersion: 4, projectAttachments: expect.arrayContaining([existing.projectAttachments![1], existing.projectAttachments![2], expect.objectContaining({ achievementSummary: 'Revised actual summary' })]),
    })))
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })


  it('rejects a team photo over 10 MB without changing the document limit', async () => {
    const view = show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled())
    const oversized = new File(['photo'], 'team.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [oversized] } })
    expect(screen.getByText('Team photo exceeds 10 MB. Please choose a smaller photo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeDisabled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })

  it.each([20 * 1024 * 1024, 20 * 1024 * 1024 + 1])('rejects documents at or above 20 MB without uploading them (%s bytes)', async (size) => {
    const view = show(existing)
    await screen.findByRole('textbox', { name: /Project Name/ })
    const oversized = new File(['document'], 'too-large.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversized, 'size', { value: size })
    fireEvent.change(view.container.querySelectorAll('input[type="file"]')[1], { target: { files: [oversized] } })
    expect(screen.getByText('Attachment must be less than 20 MB.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resubmit nomination' })).toBeDisabled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })

  it('returns from review without uploading and preserves the form', async () => {
    const view = show()
    await fill(view)
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back To Edit' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review Team Nomination' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: /Achievement Summary/ })).toHaveValue('Test-only achievement summary')
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
  })

  it('saves a restorable team draft including photo and PDF without submitting', async () => {
    const view = show()
    await fill(view)
    const pdf = new File(['%PDF-1.4 draft'], 'draft.pdf', { type: 'application/pdf' })
    fireEvent.change(view.container.querySelectorAll('input[type="file"]')[1], { target: { files: [pdf] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect((await screen.findByText(/Draft saved in this browser/)).closest('.mantine-Alert-message')).toHaveStyle({ color: '#fff' })
    const [key, data] = vi.mocked(NominationDraftStore.save).mock.calls[0]
    expect(key).toBe(nominationDraftKey({ userId: user.id, hackathonId: 'campaign', nominationType: 'team' }))
    expect(data).toEqual(expect.objectContaining({ projectName: 'Test project', photo: expect.objectContaining({ name: 'team.png' }), document: pdf }))
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
    view.unmount()
    vi.mocked(NominationDraftStore.load).mockResolvedValueOnce({ version: 1, savedAt: '2026-11-09T10:00:00.000Z', data })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Draft' }))
    expect(screen.getByText(/Draft restored/).closest('.mantine-Alert-message')).toHaveStyle({ color: '#fff' })
    expect(screen.getByRole('textbox', { name: /Project Name/ })).toHaveValue('Test project')
    expect(screen.getByRole('textbox', { name: /Core Team Member/ })).toHaveValue('Member One;Member Two')
    expect(screen.queryByTitle('Selected PDF preview: draft.pdf')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview Attachment' }))
    expect(await screen.findByTitle('Selected PDF preview: draft.pdf')).toBeInTheDocument()
  })

  it('reports storage failure without claiming the draft is saved', async () => {
    vi.mocked(NominationDraftStore.save).mockRejectedValueOnce(new Error('Quota exceeded'))
    show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect((await screen.findByText(/Unable to save your draft/)).closest('.mantine-Alert-message')).toHaveStyle({ color: '#fff' })
    expect(screen.queryByText(/Draft saved in this browser/)).not.toBeInTheDocument()
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
  })

  it('keeps the latest rejected nomination when a saved draft has an older approval version', async () => {
    vi.mocked(NominationDraftStore.load).mockResolvedValueOnce({ version: 1, savedAt: '2026-11-09T10:00:00.000Z', data: { approvalVersion: 3 } })
    show(existing)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Draft' }))
    expect(screen.getByText(/This nomination has changed since the draft/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Project Name/ })).toHaveValue('Real project')
    expect(screen.getByRole('textbox', { name: /Achievement Summary/ })).toHaveValue('Actual submitted summary')
  })

})
