import { useEffect, useState } from 'react'
import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { IconExternalLink } from '@tabler/icons-react'
import type { ProjectAttachment } from '../../services/ideaService'
import { StorageService } from '../../services/storageService'

export function NominationEvidence({ attachment }: { attachment: ProjectAttachment }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [opened, setOpened] = useState(false)
  const isDocument = attachment.type === 'document'
  const isPdf = /\.pdf(?:[?#].*)?$/i.test(attachment.name ?? '') || /\.pdf(?:[?#].*)?$/i.test(attachment.storageKey ?? attachment.url)
  useEffect(() => { setOpened(false) }, [attachment.url, attachment.storageKey])
  useEffect(() => {
    let active = true
    setError(false)
    setUrl(null)
    // 附件默认只显示文件条目，用户打开后才请求链接并加载预览。
    if (isDocument && !opened) return () => { active = false }
    const resolve = attachment.storageKey
      ? StorageService.getPresignedUrl('project-attachments', attachment.storageKey)
      : Promise.resolve(/^https?:\/\//i.test(attachment.url) || attachment.url.startsWith('/storage/') ? attachment.url : null)
    void resolve.then((value) => {
      if (!active) return
      const parsed = value ? new URL(value, window.location.origin) : null
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid attachment URL')
      setUrl(value)
    })
      .catch(() => { if (active) setError(true) })
    // 预览打开期间，在一小时签名过期前刷新链接。
    const timer = window.setInterval(() => setRevision((value) => value + 1), 50 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [attachment.url, attachment.storageKey, revision, isDocument, opened])
  return <Stack className="dp-attachment" gap="sm" style={{ minWidth: 0, width: '100%', padding: 12, background: '#071b3b', color: '#fff', borderRadius: 8 }}>
    {isDocument && <Group wrap="wrap"><Text c="white" style={{ overflowWrap: 'anywhere' }}>{attachment.name || 'Attachment'}</Text>
      <Button variant="light" c="white" onClick={() => setOpened((value) => !value)}>{opened ? 'Hide Attachment' : isPdf ? 'Preview Attachment' : 'Open Attachment'}</Button>
    </Group>}
    {(!isDocument || opened) && (error ? (
    <Alert color="red" c="white" styles={{ message: { color: '#fff' } }}><Stack gap="xs"><span>Unable to load attachment.</span>
      <Button variant="subtle" c="white" onClick={() => setRevision((value) => value + 1)}>Retry</Button>
    </Stack></Alert>
  ) : (
    <Stack><Button component="a" href={url ?? undefined} aria-disabled={!url} target="_blank" rel="noopener noreferrer"
      loading={!url} variant="light" c="white" rightSection={<IconExternalLink size={15} />}>
      {attachment.name || 'Review attachment'}
    </Button>
      {url && isDocument && isPdf && <iframe
        title={`PDF preview: ${attachment.name || 'Attachment'}`} src={url}
        style={{ display: 'block', position: 'static', width: '100%', maxWidth: '100%', height: 560, border: '1px solid #adb5bd', borderRadius: 8 }} />}
    </Stack>
  ))}
  </Stack>
}
