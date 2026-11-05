import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreTeamMembersInput } from './CoreTeamMembersInput'
import { ProfileService, type ProfileSearchResult } from '../../services/profileService'

vi.mock('../../services/profileService', () => ({ ProfileService: { searchProfiles: vi.fn() } }))
Element.prototype.scrollIntoView = vi.fn()
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const alice = { id: 'alice', name: 'Alice Zhang', email: 'alice.zhang@example.com' }
function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <MantineProvider env="test"><CoreTeamMembersInput value={value} onChange={setValue} /></MantineProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ProfileService.searchProfiles).mockResolvedValue([alice])
})

describe('Core team member lookup', () => {
  it('searches an @ email without removing its internal @ and preserves other members', async () => {
    render(<Field initial="Existing Member" />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: 'Existing Member;@alice.zhang@example.com' } })
    fireEvent.click(await screen.findByRole('option', { name: /Alice Zhang/ }))
    expect(ProfileService.searchProfiles).toHaveBeenCalledWith('alice.zhang@example.com', expect.any(AbortSignal))
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
    expect(ProfileService.searchProfiles).toHaveBeenCalledWith('Ali', expect.any(AbortSignal))
  })

  it('cancels stale lookups so a slower previous response cannot replace the current result', async () => {
    let finishFirst!: (profiles: ProfileSearchResult[]) => void
    vi.mocked(ProfileService.searchProfiles).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce([{ id: 'bob', name: 'Bob Chen', email: 'bob@example.com' }])
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: '@Alice' } })
    await waitFor(() => expect(ProfileService.searchProfiles).toHaveBeenCalledTimes(1))
    const firstSignal = vi.mocked(ProfileService.searchProfiles).mock.calls[0][1]!
    fireEvent.change(input, { target: { value: '@Bob' } })
    await screen.findByRole('option', { name: /Bob Chen/ })
    expect(firstSignal.aborted).toBe(true)
    await act(async () => finishFirst([alice]))
    expect(screen.queryByRole('option', { name: /Alice Zhang/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bob Chen/ })).toBeInTheDocument()
  })

  it('shows a recoverable search failure and searches again after editing', async () => {
    vi.mocked(ProfileService.searchProfiles).mockRejectedValueOnce(new Error('Unavailable'))
    render(<Field />)
    const input = screen.getByRole('textbox', { name: 'Core Team Member' })
    fireEvent.change(input, { target: { value: '@Al' } })
    await screen.findByText('Unable to search users. Edit the name or email to retry.')
    fireEvent.change(input, { target: { value: '@Alice' } })
    await screen.findByRole('option', { name: /Alice Zhang/ })
  })
})
