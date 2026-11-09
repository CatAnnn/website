import { Button, Group, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'

export function LocalNominationAttachment({ file }: { file: File }) {
  const [opened, setOpened] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  useEffect(() => {
    setOpened(false)
    setUrl(null)
  }, [file])
  useEffect(() => {
    if (!opened) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file, opened])
  return <Stack className="dp-attachment" gap="sm" style={{ minWidth: 0, width: '100%', position: 'relative', padding: 12, background: '#071b3b', color: '#fff', borderRadius: 8 }}>
    <Group wrap="wrap"><Text c="white" style={{ overflowWrap: 'anywhere' }}>{file.name}</Text>
      <Button variant="light" c="white" onClick={() => setOpened((value) => !value)}>
        {opened ? 'Hide Attachment' : isPdf ? 'Preview Attachment' : 'Open Attachment'}
      </Button>
    </Group>
    {opened && url && (isPdf
      ? <iframe title={`Selected PDF preview: ${file.name}`} src={url}
        style={{ display: 'block', position: 'static', width: '100%', maxWidth: '100%', height: 480, border: '1px solid #8da6ca', borderRadius: 8 }} />
      : <Button component="a" href={url} download={file.name} variant="light" c="white">Download {file.name}</Button>)}
  </Stack>
}
