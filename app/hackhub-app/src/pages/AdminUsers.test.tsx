import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { AdminUsers } from './AdminUsers'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()

const { auth, get } = vi.hoisted(() => ({
  auth: { user: { id: 'admin', name: 'Yaolong.Zhang', role: 'admin', skills: [] } },
  get: vi.fn(),
}))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }))
vi.mock('../store/authStore', () => ({ useAuthStore: () => auth }))
vi.mock('../lib/apiClient', () => ({ api: { get, patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
const accounts = [
  { id: 'admin', name: 'Yaolong.Zhang', role: 'admin', email: 'aah5sgh@bosch.com', department: 'HRL', orgCode: 'HRL-CN C/HRR-JMPCN' },
  { id: 'associate', name: 'Yiheng.LU', role: 'participant', email: 'fixed-term.Yiheng.LU@cn.bosch.com', department: 'HRL', orgCode: 'HRL' },
  { id: 'dpa', name: 'XIE Barrie', role: 'participant', email: 'bd-test.xie.barrie@bosch.com', department: 'BD/DPA', orgCode: 'BD/DPA-SRE3' },
  { id: 'swd1', name: 'ZOU Yi', role: 'participant', email: 'bd-test.zou.yi@bosch.com', department: 'BD/SWD', orgCode: 'BD/SWD-WDE1' },
  { id: 'swd2', name: 'LUO Joya', role: 'participant', email: 'bd-test.luo.joya@bosch.com', department: 'BD/SWD', orgCode: 'BD/SWD-FSB2' },
]
beforeEach(() => {
  auth.user.role = 'admin'
  get.mockReset().mockImplementation(async (path: string) => ({ content: path.includes('/admin/users') ? accounts : [] }))
})
function mount() { return render(<MantineProvider env="test"><AdminUsers /></MantineProvider>) }
describe('Award account departments', () => {
  it('shows roster departments even without organization membership', async () => {
    mount()
    expect(await screen.findByText('XIE Barrie')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Department' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByText('HRL')).toHaveLength(1)
    expect(screen.getByText('HRL-CN C/HRR-JMPCN')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'User Management' })).toHaveStyle({ color: 'var(--mantine-color-white)' })
    expect(screen.getByText('BD/DPA-SRE3')).toBeInTheDocument()
    expect(screen.getByText('Yiheng.LU')).toBeInTheDocument()
  })
  it('filters by the shared department prefix and searches full Org.code', async () => {
    mount()
    await screen.findByText('XIE Barrie')
    fireEvent.click(screen.getByPlaceholderText('Filter by department'))
    fireEvent.click(await screen.findByRole('option', { name: 'BD/SWD' }))
    await waitFor(() => expect(screen.queryByText('XIE Barrie')).not.toBeInTheDocument())
    expect(screen.getByText('ZOU Yi')).toBeInTheDocument()
    expect(screen.getByText('LUO Joya')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search users...'), { target: { value: 'BD/SWD-FSB2' } })
    expect(screen.queryByText('ZOU Yi')).not.toBeInTheDocument()
    expect(screen.getByText('LUO Joya')).toBeInTheDocument()
  })
  it('does not load any management data for an HRL ordinary user', () => {
    auth.user.role = 'participant'
    mount()
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
  })
})
