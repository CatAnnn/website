import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreTeamMembersInput } from './CoreTeamMembersInput'
import { TeamMemberService, type TeamMemberMatch } from '../../services/teamMemberService'

vi.mock('../../services/teamMemberService', () => ({ TeamMemberService: { search: vi.fn() } }))
Element.prototype.scrollIntoView = vi.fn()
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const alice = { id: 'alice', name: 'Alice Zhang', orgUnit: 'BD/IT' }
function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <MantineProvider env="test"><CoreTeamMembersInput value={value} onChange={setValue} /></MantineProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(TeamMemberService.search).mockResolvedValue([alice])
})

describe('Core team member lookup', () => {
  it('searches an @ roster name and preserves other members', async () => {
    render(<Field initial="Existing Member" />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: 'Existing Member;@Alice Zhang' } })
    fireEvent.click(await screen.findByRole('option', { name: /Alice Zhang/ }))
    expect(TeamMemberService.search).toHaveBeenCalledWith('Alice Zhang', expect.any(AbortSignal))
    expect(input).toHaveValue('Existing Member;Alice Zhang')
  })

  it('supports keyboard selection by name and keeps following members when replacing a middle token', async () => {
    render(<Field initial="First Member;@Ali;Last Member" />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' }) as HTMLTextAreaElement
    input.setSelectionRange(16, 16)
    fireEvent.click(input)
    await screen.findByRole('option', { name: /Alice Zhang/ })
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(input).toHaveValue('First Member;Alice Zhang;Last Member')
    expect(TeamMemberService.search).toHaveBeenCalledWith('Ali', expect.any(AbortSignal))
  })

  it('matches a Chinese surname with a full-width @ and normalizes Chinese separators', async () => {
    const member = { id: 'wang', name: 'WANG Weimin', orgUnit: 'BD/SLP-CO' }
    vi.mocked(TeamMemberService.search).mockResolvedValue([member])
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: 'Existing Member；＠王' } })
    fireEvent.click(await screen.findByRole('option', { name: /WANG Weimin/ }))
    expect(TeamMemberService.search).toHaveBeenCalledWith('王', expect.any(AbortSignal))
    expect(input).toHaveValue('Existing Member;WANG Weimin')
  })

  it('waits for Chinese composition to finish before searching or selecting a member', async () => {
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '@wang' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    expect(TeamMemberService.search).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '@王卫' } })
    fireEvent.compositionEnd(input)
    await screen.findByRole('option', { name: /Alice Zhang/ })
    expect(TeamMemberService.search).toHaveBeenCalledOnce()
    expect(TeamMemberService.search).toHaveBeenCalledWith('王卫', expect.any(AbortSignal))
    expect(input).toHaveValue('@王卫')
  })

  it('cancels stale lookups so a slower previous response cannot replace the current result', async () => {
    let finishFirst!: (profiles: TeamMemberMatch[]) => void
    vi.mocked(TeamMemberService.search).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce([{ id: 'bob', name: 'Bob Chen', orgUnit: 'BD/HR' }])
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: '@Alice' } })
    await waitFor(() => expect(TeamMemberService.search).toHaveBeenCalledTimes(1))
    const firstSignal = vi.mocked(TeamMemberService.search).mock.calls[0][1]!
    fireEvent.change(input, { target: { value: '@Bob' } })
    await screen.findByRole('option', { name: /Bob Chen/ })
    expect(firstSignal.aborted).toBe(true)
    await act(async () => finishFirst([alice]))
    expect(screen.queryByRole('option', { name: /Alice Zhang/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bob Chen/ })).toBeInTheDocument()
  })

  it('shows a recoverable search failure and searches again after editing', async () => {
    vi.mocked(TeamMemberService.search).mockRejectedValueOnce(new Error('Unavailable'))
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: '@Al' } })
    await screen.findByText('Unable to search team members. Edit the name to retry.')
    fireEvent.change(input, { target: { value: '@Alice' } })
    await screen.findByRole('option', { name: /Alice Zhang/ })
  })
})
