import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { Login } from './Login'

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MantineProvider>
        <Login />
      </MantineProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ enabled: true })))
})

afterEach(() => vi.unstubAllGlobals())

describe('Login', () => {
  it('offers company sign-in without password or registration controls', async () => {
    renderLogin()
    expect(await screen.findByRole('link', { name: 'Bosch Single-Sign-On' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Login For Employees' })).toBeInTheDocument()
    expect(screen.getByText(/No separate registration is required/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/password manager/i)).not.toBeInTheDocument()
  })

  it('uses the supplied Bosch and CN Award artwork with the home link', async () => {
    renderLogin()
    await screen.findByRole('link', { name: 'Bosch Single-Sign-On' })
    expect(screen.getByRole('link', { name: 'Bosch CN Award home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('img', { name: 'BOSCH' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'CN Award' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Corporate information' })).toHaveAttribute('href', 'https://www.bosch.com/corporate-information/')
  })

  it('preserves the requested destination when starting company sign-in', async () => {
    renderLogin('/login?redirect=%2Fnominate')
    expect(await screen.findByRole('link', { name: 'Bosch Single-Sign-On' })).toHaveAttribute(
      'href', '/api/v1/auth/oidc/authorize/bosch?redirect=%2Fnominate'
    )
  })

  it('keeps account-linking errors and administrator guidance visible', async () => {
    renderLogin('/login?sso_error=account_not_linked')
    await screen.findByRole('link', { name: 'Bosch Single-Sign-On' })
    expect(screen.getByRole('alert')).toHaveTextContent('link your company identity to your existing account')
    expect(within(screen.getByRole('contentinfo')).getByText(/Please contact the portal administrator/)).toBeInTheDocument()
  })

  it('explains when company sign-in is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')))
    renderLogin()
    expect(within(screen.getByRole('contentinfo')).getByText(/Please contact the portal administrator/)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Company sign-in is currently unavailable')
    expect(screen.queryByRole('link', { name: 'Bosch Single-Sign-On' })).not.toBeInTheDocument()
  })
})
