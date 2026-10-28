import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'
import { LanguageProvider } from '../contexts/LanguageContext'
import { DigitalPioneerOverview } from './DigitalPioneerOverview'

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
    expect(screen.getAllByRole('link', { name: 'Start a nomination' }).length).toBeGreaterThan(0)
    for (const period of ['Nov.16-28', 'Nov.30-Dec.11', 'Dec.14-25', 'Jan.']) {
      expect(screen.getByText(period)).toBeInTheDocument()
    }
  })
})
