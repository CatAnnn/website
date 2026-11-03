import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { VotingCriteriaManager } from './VotingCriteriaManager'

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
const mocks=vi.hoisted(()=>({getCriteria:vi.fn(),applyAwardTemplate:vi.fn()}))
vi.mock('../services/votingService',()=>({VotingService:mocks}))
vi.mock('@mantine/notifications',()=>({notifications:{show:vi.fn()}}))
it('shows the four invalid test criteria and replaces them only after confirmation',async()=>{
  mocks.getCriteria.mockResolvedValue(['111111','22222','333333','444444'].map((name,i)=>({id:String(i),name,weight:25,displayOrder:i})))
  mocks.applyAwardTemplate.mockImplementation(async()=>{
    const official=[1,2,3].map((slot)=>({id:String(slot),name:`DPA track criterion ${slot}`,weight:slot===1?40:30,displayOrder:slot-1}))
    mocks.getCriteria.mockResolvedValue(official)
    return official
  })
  render(<MantineProvider env="test"><VotingCriteriaManager hackathonId="award-1" isManager /></MantineProvider>)
  expect(await screen.findByText('111111')).toBeInTheDocument()
  expect(screen.getByText('Invalid',{exact:true})).toBeInTheDocument()
  expect(screen.queryByText('Valid',{exact:true})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Apply 2026 DPA template'}))
  expect(mocks.applyAwardTemplate).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button',{name:'Confirm official criteria'}))
  await waitFor(()=>expect(screen.queryByText('111111')).not.toBeInTheDocument())
  expect(screen.getByText('Valid',{exact:true})).toBeInTheDocument()
  expect(mocks.applyAwardTemplate).toHaveBeenCalledWith('award-1')
})
