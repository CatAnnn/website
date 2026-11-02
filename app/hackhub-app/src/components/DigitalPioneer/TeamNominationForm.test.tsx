import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamNominationForm } from './TeamNominationForm'
import { TeamService, type Team, type TeamMember } from '../../services/teamService'
import { IdeaService, type Idea } from '../../services/ideaService'
import { StorageService } from '../../services/storageService'

vi.mock('../../services/teamService', () => ({ TeamService: { getTeams: vi.fn(), getMyTeams: vi.fn(), createTeam: vi.fn(), joinTeam: vi.fn() } }))
vi.mock('../../services/ideaService', () => ({ IdeaService: { createIdea: vi.fn(), updateIdea: vi.fn() } }))
vi.mock('../../services/storageService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/storageService')>(),
  StorageService: { uploadFile: vi.fn(), getPresignedUrl: vi.fn() },
}))
const user = { id: 'captain', name: 'Signed-in Captain', email: 'captain@example.com', role: 'participant' as const, skills: [] }
const team: Team = { id: 'team', name: 'Created team', description: '', hackathonId: 'campaign', createdBy: user.id, isOpen: true, skills: [], avatarUrl: null, createdAt: '', updatedAt: '' }
const member: TeamMember = { id: 'membership', teamId: team.id, userId: user.id, role: 'leader', joinedAt: '' }
const existing = {
  id: 'rejected', createdBy: user.id, teamId: team.id, hackathonId: 'campaign', category: 'customer-values', approvalStatus: 'rejected', approvalVersion: 4,
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
  fireEvent.change(screen.getByRole('textbox', { name: /How you demonstrate/ }), { target: { value: 'Test culture evidence' } })
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['photo'], 'team.png', { type: 'image/png' })] } })
}

beforeEach(() => {
  vi.clearAllMocks()
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
  it('shows a membership notice and no editable form to members', async () => {
    vi.mocked(TeamService.getMyTeams).mockResolvedValue([{ ...member, role: 'member' }])
    show()
    await screen.findByText(/Only the team creator/)
    expect(screen.queryByRole('textbox', { name: /Project Name/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit nomination' })).not.toBeInTheDocument()
  })
  it('does not give a promoted leader who did not create the team editing rights', async () => {
    vi.mocked(TeamService.getTeams).mockResolvedValue([{ ...team, createdBy: 'someone-else' }])
    show()
    await screen.findByText(/Only the team creator/)
    expect(screen.queryByRole('textbox', { name: /Project Name/ })).not.toBeInTheDocument()
  })
  it('submits the captain’s actual structured fields and original team photo without cropping', async () => {
    const view = show()
    await fill(view)
    expect(screen.getByRole('textbox', { name: 'NominatorName' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'NominatorName' })).toHaveValue(user.name)
    expect(screen.getByText(/Only BDCN team employees/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit nomination' }))
    await waitFor(() => expect(IdeaService.createIdea).toHaveBeenCalledOnce())
    expect(StorageService.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'team.png' }), 'project-attachments', 'nominations/campaign/captain')
    expect(IdeaService.createIdea).toHaveBeenCalledWith(expect.objectContaining({ teamId: team.id,
      projectAttachments: expect.arrayContaining([expect.objectContaining({ nominationType: 'team', projectName: 'Test project', coreTeamMembers: 'Member One;Member Two', achievementSummary: 'Test-only achievement summary', teamAchievementImpact: 'Measurable test impact', cultureDemonstration: 'Test culture evidence' })]),
    }))
    expect(TeamService.createTeam).not.toHaveBeenCalled()
  })
  it('blocks a summary over 200 words before uploading or submitting', async () => {
    const view = show()
    await fill(view, Array.from({ length: 201 }, () => 'word').join(' '))
    expect(screen.getByText('201 / 200 words')).toBeInTheDocument()
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
    expect(screen.getByRole('textbox', { name: 'NominatorName' })).toHaveValue('Saved nominator')
    expect(screen.getByText('Retained attachment: evidence.pdf')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Achievement Summary/ }), { target: { value: 'Revised actual summary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit nomination' }))
    await waitFor(() => expect(IdeaService.updateIdea).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      approvalVersion: 4, projectAttachments: expect.arrayContaining([existing.projectAttachments![1], existing.projectAttachments![2], expect.objectContaining({ achievementSummary: 'Revised actual summary' })]),
    })))
    expect(IdeaService.createIdea).not.toHaveBeenCalled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })
  it('creates the team only once then verifies captain membership before showing its form', async () => {
    vi.mocked(TeamService.getMyTeams).mockResolvedValueOnce([]).mockResolvedValue([member])
    vi.mocked(TeamService.createTeam).mockResolvedValue(team)
    show()
    await screen.findByRole('textbox', { name: 'Team name' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Team name' }), { target: { value: 'New real team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }))
    await screen.findByRole('textbox', { name: /Project Name/ })
    expect(TeamService.createTeam).toHaveBeenCalledExactlyOnceWith({ name: 'New real team', description: '', hackathonId: 'campaign' })
  })
  it('joins an existing team and then exposes only the member notice', async () => {
    vi.mocked(TeamService.getMyTeams).mockResolvedValueOnce([]).mockResolvedValue([{ ...member, role: 'member' }])
    vi.mocked(TeamService.joinTeam).mockResolvedValue({ ...member, role: 'member' })
    show()
    await userEvent.click(await screen.findByRole('textbox', { name: 'Available teams' }))
    await userEvent.click(await screen.findByRole('option', { name: team.name }))
    await userEvent.click(screen.getByRole('button', { name: 'Join team' }))
    await screen.findByText(/Only the team creator/)
    expect(TeamService.joinTeam).toHaveBeenCalledExactlyOnceWith(team.id)
    expect(screen.queryByRole('textbox', { name: /Project Name/ })).not.toBeInTheDocument()
  })
  it('rejects documents over 50 MB without uploading them', async () => {
    const view = show(existing)
    await screen.findByRole('textbox', { name: /Project Name/ })
    const oversized = new File(['document'], 'too-large.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 })
    fireEvent.change(view.container.querySelectorAll('input[type="file"]')[1], { target: { files: [oversized] } })
    expect(screen.getByText('Attachment exceeds 50 MB.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resubmit nomination' })).toBeDisabled()
    expect(StorageService.uploadFile).not.toHaveBeenCalled()
  })
  it('fails closed when current membership cannot be loaded', async () => {
    vi.mocked(TeamService.getMyTeams).mockRejectedValue(new Error('Unavailable'))
    show()
    await screen.findByText(/Unable to load your team membership/)
    expect(screen.queryByRole('button', { name: 'Create team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit nomination' })).not.toBeInTheDocument()
  })
})
