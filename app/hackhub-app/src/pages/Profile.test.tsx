import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { Profile } from './Profile'

const { updateProfile, showNotification } = vi.hoisted(() => ({ updateProfile: vi.fn(), showNotification: vi.fn() }))
vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: { name: 'Alice', email: 'alice@example.com', role: 'participant' }, updateProfile }) }))
vi.mock('@mantine/notifications', () => ({ notifications: { show: showNotification } }))

describe('Profile account details', () => {
  it('shows actual account fields without fabricated activity or editable sign-in email', () => {
    render(<MantineProvider><Profile /></MantineProvider>)
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Alice', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Activity Stats')).not.toBeInTheDocument()
    expect(screen.queryByText('Default Hackathon Filter')).not.toBeInTheDocument()
  })
  it('reports a failed save without claiming success', async () => {
    updateProfile.mockRejectedValueOnce(new Error('Save unavailable'))
    const user = userEvent.setup()
    render(<MantineProvider><Profile /></MantineProvider>)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unable to save', message: 'Save unavailable' }))
    expect(showNotification).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Profile updated' }))
  })
})
