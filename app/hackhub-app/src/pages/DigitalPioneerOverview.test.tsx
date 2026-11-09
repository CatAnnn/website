import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../contexts/LanguageContext'
import { DigitalPioneerOverview } from './DigitalPioneerOverview'

beforeEach(() => sessionStorage.clear())

describe('DigitalPioneerOverview', () => {
  it('introduces the individual award and all three categories', () => {
    render(
      <MemoryRouter>
        <MantineProvider>
          <LanguageProvider>
            <DigitalPioneerOverview />
          </LanguageProvider>
        </MantineProvider>
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { name: /Digital\s*Pioneer/ })).toBeInTheDocument()
    expect(screen.getAllByText('客户价值').length).toBeGreaterThan(0)
    expect(screen.getAllByText('创新破局').length).toBeGreaterThan(0)
    expect(screen.getAllByText('协作共赢').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Start A Nomination' }).length).toBeGreaterThan(0)
    for (const period of ['Nov.16-28', 'Nov.30-Dec.11', 'Dec.14-25', 'Jan.']) {
      expect(screen.getByText(period)).toBeInTheDocument()
    }
  })

  it('switches the exact Individual/Team criteria and carries the type to nomination', () => {
    render(<MemoryRouter><MantineProvider><LanguageProvider><DigitalPioneerOverview /></LanguageProvider></MantineProvider></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Individual', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Growing Together With Customers (30%)')).toBeVisible()
    expect(screen.getByText('Innovation Mindset (30%)')).toBeVisible()
    expect(screen.getByText('Breaking Down Silos (30%)')).toBeVisible()
    expect(screen.queryByText('Cross-Functional Synergy (30%)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Team', exact: true }))
    expect(screen.getByText('Customer Partnership & Growth (30%)')).toBeVisible()
    expect(screen.getByText('Level Of Innovation (30%)')).toBeVisible()
    expect(screen.getByText('Cross-Functional Synergy (30%)')).toBeVisible()
    expect(screen.getByText('Shared Goals & Decision Speed (35%)')).toBeVisible()
    expect(screen.getByText('Win-As-A-Team Culture (35%)')).toBeVisible()
    expect(screen.queryByText('Breaking Down Silos (30%)')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start A Nomination' })).toHaveAttribute('href', '/nominate?type=team')
    expect(sessionStorage.getItem('award-nomination-type')).toBe('team')
    fireEvent.click(screen.getByRole('button', { name: 'Individual', exact: true }))
    expect(screen.getByText('Promoting Joint Success (35%)')).toBeVisible()
    expect(screen.queryByText('Win-As-A-Team Culture (35%)')).not.toBeInTheDocument()
  })
})
