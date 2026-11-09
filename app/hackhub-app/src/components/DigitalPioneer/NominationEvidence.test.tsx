import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { NominationEvidence } from './NominationEvidence'
const { getPresignedUrl } = vi.hoisted(() => ({ getPresignedUrl: vi.fn() }))
vi.mock('../../services/storageService', () => ({ StorageService: { getPresignedUrl } }))
beforeEach(() => { vi.clearAllMocks() })
it('uses a fresh signed URL instead of the expired stored URL', async () => {
  getPresignedUrl.mockResolvedValue('/storage/photos/fresh?signature=new')
  render(<MantineProvider><NominationEvidence attachment={{ type: 'screenshot', name: 'Photo', storageKey: 'photo.png', url: '/storage/expired' }} /></MantineProvider>)
  expect(await screen.findByRole('link', { name: 'Photo' })).toHaveAttribute('href', '/storage/photos/fresh?signature=new')
  expect(getPresignedUrl).toHaveBeenCalledWith('project-attachments', 'photo.png')
})
it('shows failure and retries without opening an expired URL', async () => {
  getPresignedUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('/storage/retry')
  render(<MantineProvider><NominationEvidence attachment={{ type: 'screenshot', name: 'Photo', storageKey: 'photo.png', url: '/storage/expired' }} /></MantineProvider>)
  await screen.findByText('Unable to load attachment.')
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('link', { name: 'Photo' })).toHaveAttribute('href', '/storage/retry')
})

it('loads and embeds a PDF only after preview is requested, and hides it on demand', async () => {
 getPresignedUrl.mockResolvedValue('/storage/current.pdf')
 render(<MantineProvider><NominationEvidence attachment={{type:'document',name:'evidence.pdf',storageKey:'folder/evidence.pdf',url:''}} /></MantineProvider>)
 expect(screen.getByText('evidence.pdf')).toBeInTheDocument()
 expect(screen.queryByTitle('PDF preview: evidence.pdf')).not.toBeInTheDocument()
 expect(getPresignedUrl).not.toHaveBeenCalled()
 await userEvent.click(screen.getByRole('button', { name: 'Preview Attachment' }))
 expect(await screen.findByTitle('PDF preview: evidence.pdf')).toHaveAttribute('src','/storage/current.pdf')
 await userEvent.click(screen.getByRole('button', { name: 'Hide Attachment' }))
 expect(screen.queryByTitle('PDF preview: evidence.pdf')).not.toBeInTheDocument()
})
