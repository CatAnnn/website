vi.mock('../hooks/useRealtime', () => ({useRealtime: () => ({isConnected:false, subscribeToHackathonUpdates:vi.fn()})}))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render as renderView, screen, fireEvent } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ProjectShowcase } from './ProjectShowcase'

const render = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderView(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: null }) }))
const { getNominations } = vi.hoisted(() => ({ getNominations: vi.fn().mockResolvedValue({ content: [{
  id: 'nominee-1', title: 'Public nomination', description: 'Published achievement', nominee_name: 'Associate',
  nominee_org_code: 'BD/DPA-SRE3', hackathon_id: 'award-1', category: 'Customer Values', technologies: [],
  images: [], votes: 2, status: 'submitted', created_at: '', submission_date: '',
}] }) }))
vi.mock('../services/publicAwardService', () => ({ PublicAwardService: {
  getAwards: vi.fn().mockResolvedValue({ content: [{ id: 'award-1', title: '2026 Award', status: 'running' }] }),
  getNominations,
} }))
function LoginTarget() { return <p>Login destination: {useLocation().search}</p> }
function page(nominationMode = false) {
  return render(<MantineProvider env="test"><MemoryRouter initialEntries={['/projects?type=individual']}><Routes>
    <Route path="/projects" element={<ProjectShowcase nominationMode={nominationMode} />} />
    <Route path="/login" element={<LoginTarget />} />
  </Routes></MemoryRouter></MantineProvider>)
}
describe('Public award browsing', () => {
  it('lets guests browse details and requires login only after clicking vote', async () => {
    page()
    expect(await screen.findByText('Public nomination')).toBeInTheDocument()
    expect(screen.queryByText(/Login destination/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(await screen.findByRole('heading', { name: 'Nominee' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Committee scoring' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset my track votes' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Vote (2)' }))
    expect(await screen.findByText(/Login destination/)).toHaveTextContent('redirect=%2Fprojects%3Fnominee%3Dnominee-1')
  })
  it('shows the original nomination fields without asking guests to log in', async () => {
    page(true)
    fireEvent.click(await screen.findByRole('radio', { name: /Customer Values/ }))
    expect(await screen.findByRole('textbox', { name: /Executive Summary/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit nomination' })).toBeDisabled()
    expect(screen.queryByText(/Login destination/)).not.toBeInTheDocument()
  })
  it('combines department, category and candidate filters using the displayed department prefix', async () => {
    const candidate = (id: string, org: string, category: string, tags: string[] = ['Java']) => ({
      id, title: id, description: 'Contribution', nominee_name: id,
      nominee_org_code: org, hackathon_id: 'award-1', category, technologies: tags,
      images: [], votes: 0, status: 'submitted', created_at: '', submission_date: '',
    })
    getNominations.mockResolvedValueOnce({ content: [
      candidate('Alice', 'BD/DPA-SRE3', 'Customer Values'),
      candidate('Ann', 'BD/DPA-AP', 'Innovation Breakthrough'),
      candidate('Bob', 'HRL', 'Customer Values'),
      candidate('Cara', '', 'Customer Values'),
    ] })
    const user = userEvent.setup()
    page()
    await screen.findByText('Alice', { selector: 'h3' })
    const department = screen.getByRole('textbox', { name: 'Filter by department' })
    await user.click(department)
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['BD/DPA', 'HRL'])
    await user.click(screen.getByRole('option', { name: 'BD/DPA' }))
    expect(document.querySelectorAll('.dp-project-card')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Customer Values/ }))
    expect(document.querySelectorAll('.dp-project-card')).toHaveLength(1)
    await user.type(screen.getByPlaceholderText('Search nominees'), 'Bob')
    expect(await screen.findByText('No nominations match these filters.')).toBeInTheDocument()
    await user.clear(screen.getByPlaceholderText('Search nominees'))
    expect(document.querySelectorAll('.dp-project-card')).toHaveLength(1)
    await user.click(department)
    await user.click(screen.getByRole('option', { name: 'HRL' }))
    expect(screen.getByText('Bob', { selector: 'h3' })).toBeInTheDocument()
  })

})
