import { Combobox, Text, Textarea, useCombobox } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { TeamMemberService, type TeamMemberMatch } from '../../services/teamMemberService'

interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

// 中文单字可以作为姓名关键词，英文至少输入两个字符。
const canSearch = (query: string) => query.length <= 200
  && (/\p{Script=Han}/u.test(query) || query.replace(/\s/g, '').length >= 2)

export function CoreTeamMembersInput({ value, onChange, disabled }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const [isComposing, setIsComposing] = useState(false)
  const [token, setToken] = useState({ query: '', start: 0, end: 0 })
  const [results, setResults] = useState<TeamMemberMatch[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })

  useEffect(() => {
    setResults([])
    if (disabled || isComposing || !canSearch(token.query)) {
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    // 输入防抖并取消过期请求，避免旧搜索结果覆盖当前名册查询。
    const timer = window.setTimeout(() => {
      void TeamMemberService.search(token.query, controller.signal).then((profiles) => {
        if (controller.signal.aborted) return
        setResults(profiles)
        setStatus('ready')
      }).catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [token.query, disabled, isComposing])

  const updateToken = (text: string, caret: number) => {
    const start = text.lastIndexOf(';', Math.max(0, caret - 1)) + 1
    const separator = text.indexOf(';', caret)
    const end = separator < 0 ? text.length : separator
    const query = text.slice(start, end).trim().replace(/^[@＠]/u, '').trim()
    setToken({ query, start, end })
    combobox.resetSelectedOption()
    if (canSearch(query) && !composing.current) combobox.openDropdown()
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
        placeholder={'Type @ followed by a Chinese or English name keyword; separate members with “;”. Only BDCN team employees may be included. 输入 @ 加中文或英文姓名关键词搜索，多位员工用“;”分隔。'}
        value={value} onChange={(event) => {
          // 全角分号转为等长的英文分号，保留原有提交格式和光标位置。
          const next = event.currentTarget.value.replace(/；/g, ';')
          onChange(next)
          if (!composing.current) updateToken(next, event.currentTarget.selectionStart)
        }}
        onCompositionStart={() => {
          composing.current = true
          setIsComposing(true)
          combobox.closeDropdown()
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          setIsComposing(false)
          updateToken(event.currentTarget.value, event.currentTarget.selectionStart)
        }}
        onKeyDownCapture={(event) => {
          // 输入法确认中文时不触发候选员工的键盘选择。
          if (composing.current) event.stopPropagation()
        }}
        onClick={(event) => updateToken(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => combobox.closeDropdown()} />
    </Combobox.Target>
    <Combobox.Dropdown className="dp-member-dropdown">
      <Combobox.Options mah={240} style={{ overflowY: 'auto' }}>
        {status === 'loading' && <Combobox.Empty>Searching team members…</Combobox.Empty>}
        {status === 'error' && <Combobox.Empty>Unable to search team members. Edit the name to retry.</Combobox.Empty>}
        {status === 'ready' && results.length === 0 && <Combobox.Empty>No matching team members.</Combobox.Empty>}
        {results.map((profile) => <Combobox.Option value={profile.id} key={profile.id}>
          <Text size="sm" c="#eef5ff">{profile.name}</Text><Text size="xs" c="#bcc9dc">{profile.orgUnit}</Text>
        </Combobox.Option>)}
      </Combobox.Options>
    </Combobox.Dropdown>
  </Combobox>
}
