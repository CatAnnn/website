import { Combobox, Text, Textarea, useCombobox } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { ProfileService, type ProfileSearchResult } from '../../services/profileService'

interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function CoreTeamMembersInput({ value, onChange, disabled }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [token, setToken] = useState({ query: '', start: 0, end: 0 })
  const [results, setResults] = useState<ProfileSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })

  useEffect(() => {
    setResults([])
    if (disabled || token.query.length < 2 || token.query.length > 200) {
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    // 输入防抖并取消过期请求，避免旧搜索结果覆盖当前姓名或邮箱。
    const timer = window.setTimeout(() => {
      void ProfileService.searchProfiles(token.query, controller.signal).then((profiles) => {
        if (controller.signal.aborted) return
        setResults(profiles)
        setStatus('ready')
      }).catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [token.query, disabled])

  const updateToken = (text: string, caret: number) => {
    const start = text.lastIndexOf(';', Math.max(0, caret - 1)) + 1
    const separator = text.indexOf(';', caret)
    const end = separator < 0 ? text.length : separator
    const query = text.slice(start, end).trim().replace(/^@/, '')
    setToken({ query, start, end })
    combobox.resetSelectedOption()
    if (query.length >= 2 && query.length <= 200) combobox.openDropdown()
    else combobox.closeDropdown()
  }

  const chooseMember = (id: string) => {
    const profile = results.find((result) => result.id === id)
    if (!profile) return
    // 仅替换光标所在成员，保留原有分号格式及其他已填成员。
    const next = `${value.slice(0, token.start)}${profile.name}${value.slice(token.end)}`
    onChange(next)
    combobox.closeDropdown()
    input.current?.focus()
    requestAnimationFrame(() => input.current?.setSelectionRange(token.start + profile.name.length, token.start + profile.name.length))
  }

  return <Combobox store={combobox} onOptionSubmit={chooseMember}>
    <Combobox.Target>
      <Textarea ref={input} label="Core Team Member" required autosize minRows={3} resize="vertical" disabled={disabled}
        placeholder={'Enter Outlook names separated by “;”. Only BDCN team employees may be included. 仅填写 BDCN 团队员工，请填写 Outlook name，用“;”分割。'}
        value={value} onChange={(event) => {
          onChange(event.currentTarget.value)
          updateToken(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onClick={(event) => updateToken(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => combobox.closeDropdown()} />
    </Combobox.Target>
    <Combobox.Dropdown>
      <Combobox.Options mah={240} style={{ overflowY: 'auto' }}>
        {status === 'loading' && <Combobox.Empty>Searching users…</Combobox.Empty>}
        {status === 'error' && <Combobox.Empty>Unable to search users. Edit the name or email to retry.</Combobox.Empty>}
        {status === 'ready' && results.length === 0 && <Combobox.Empty>No matching users.</Combobox.Empty>}
        {results.map((profile) => <Combobox.Option value={profile.id} key={profile.id}>
          <Text size="sm">{profile.name}</Text><Text size="xs" c="dimmed">{profile.email}</Text>
        </Combobox.Option>)}
      </Combobox.Options>
    </Combobox.Dropdown>
  </Combobox>
}
