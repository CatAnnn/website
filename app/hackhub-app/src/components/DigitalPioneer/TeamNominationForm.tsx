import { Alert, Button, Card, FileInput, Grid, Group, Image, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { getDigitalPioneerTracks } from '../../config/digitalPioneer'
import { IdeaService, type CreateIdeaInput, type Idea, type ProjectAttachment } from '../../services/ideaService'
import { MAX_UPLOAD_BYTES, PHOTO_ACCEPT, StorageService, validatePersonalPhoto } from '../../services/storageService'
import { TeamService } from '../../services/teamService'
import type { AuthUser } from '../../store/authStore'

interface Props {
  user: AuthUser
  hackathonId: string
  category: string
  onCategoryChange: (category: string) => void
  canSubmit: boolean
  editing?: Idea | null
  onSubmitted: (idea: Idea) => void
}

const documentAccept = '.pdf,.txt,.md,.zip'
const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0

export function TeamNominationForm({ user, hackathonId, category, onCategoryChange, canSubmit, editing, onSubmitted }: Props) {
  const metadata = editing?.projectAttachments?.find((item) => item.type === 'nomination')
  const [projectName, setProjectName] = useState(metadata?.projectName ?? '')
  const [coreTeamMembers, setCoreTeamMembers] = useState(metadata?.coreTeamMembers ?? '')
  const [achievementSummary, setAchievementSummary] = useState(metadata?.achievementSummary ?? '')
  const [teamAchievementImpact, setTeamAchievementImpact] = useState(metadata?.teamAchievementImpact ?? '')
  const [cultureDemonstration, setCultureDemonstration] = useState(metadata?.cultureDemonstration ?? '')
  const [teamName, setTeamName] = useState('')
  const [joinTeamId, setJoinTeamId] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [document, setDocument] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const membership = useQuery({
    queryKey: ['nomination-team-membership', user.id, hackathonId],
    queryFn: async () => {
      const [teams, memberships] = await Promise.all([TeamService.getTeams(hackathonId), TeamService.getMyTeams()])
      return { teams, memberships }
    },
    staleTime: 0,
  })
  const ownMembership = membership.data?.memberships.find((item) => item.userId === user.id
    && membership.data?.teams.some((team) => team.id === item.teamId))
  const team = membership.data?.teams.find((item) => item.id === ownMembership?.teamId)
  const isCaptain = team?.createdBy === user.id && ownMembership?.role === 'leader'
    && (!editing || editing.teamId === team.id)
  const savedPhoto = editing?.projectAttachments?.find((item) => item.type === 'screenshot')
  const savedDocuments = editing?.projectAttachments?.filter((item) => item.type === 'document') ?? []
  const photoError = validatePersonalPhoto(photo)
  const documentError = document && (document.size === 0 ? 'The selected attachment is empty.'
    : document.size > MAX_UPLOAD_BYTES ? 'Attachment exceeds 50 MB.' : null)
  const summaryWords = countWords(achievementSummary)

  useEffect(() => {
    let active = true
    if (photo && !validatePersonalPhoto(photo)) {
      const url = URL.createObjectURL(photo)
      setPhotoPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPhotoPreview(null)
    if (savedPhoto) {
      const request = savedPhoto.storageKey
        ? StorageService.getPresignedUrl('project-attachments', savedPhoto.storageKey)
        : Promise.resolve(savedPhoto.url)
      void request.then((url) => { if (active) setPhotoPreview(url) }).catch(() => undefined)
    }
    return () => { active = false }
  }, [photo, savedPhoto])

  const changeMembership = async (action: 'create' | 'join') => {
    if (busyRef.current || ownMembership || membership.isPending || membership.isError) return
    if (action === 'create' && !teamName.trim()) { setError('Enter a team name.'); return }
    if (action === 'join' && !joinTeamId) { setError('Choose a team to join.'); return }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (action === 'create') {
        await TeamService.createTeam({ name: teamName.trim(), description: '', hackathonId })
      } else {
        await TeamService.joinTeam(joinTeamId!)
      }
      await membership.refetch({ throwOnError: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update team membership. Please retry.')
      void membership.refetch()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!isCaptain || !canSubmit || busyRef.current) return
    setError(null)
    if (!projectName.trim() || !category || !coreTeamMembers.trim() || !achievementSummary.trim()
      || !teamAchievementImpact.trim() || !cultureDemonstration.trim() || (!photo && !savedPhoto)) {
      setError('Complete all required fields and upload a team photo.')
      return
    }
    if (summaryWords > 200 || photoError || documentError) {
      setError(photoError || documentError || 'Achievement Summary must be 200 words or fewer.')
      return
    }
    if (coreTeamMembers.split(';').some((name) => !name.trim()) || /[；\n\r]/u.test(coreTeamMembers)) {
      setError('Enter Outlook names separated by semicolons (;), without empty names.')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      const prefix = `nominations/${hackathonId}/${user.id}`
      const [uploadedPhoto, uploadedDocument] = await Promise.all([
        photo ? StorageService.uploadFile(photo, 'project-attachments', prefix) : null,
        document ? StorageService.uploadFile(document, 'project-attachments', prefix) : null,
      ])
      const attachments: ProjectAttachment[] = [{
        type: 'nomination', nominationType: 'team', url: '', name: projectName.trim(), nomineeUserId: user.id,
        projectName: projectName.trim(), coreTeamMembers: coreTeamMembers.trim(), achievementSummary: achievementSummary.trim(),
        teamAchievementImpact: teamAchievementImpact.trim(), cultureDemonstration: cultureDemonstration.trim(),
      }]
      if (uploadedPhoto && photo) attachments.push({ type: 'screenshot', name: photo.name, url: uploadedPhoto.url, storageKey: uploadedPhoto.key })
      else if (savedPhoto) attachments.push(savedPhoto)
      if (uploadedDocument && document) attachments.push({ type: 'document', name: document.name, url: uploadedDocument.url, storageKey: uploadedDocument.key })
      else attachments.push(...savedDocuments)
      const payload: CreateIdeaInput = {
        title: projectName.trim(), hackathonId, teamId: team!.id, category, status: 'submitted', tags: [],
        description: [
          `Achievement Summary\n${achievementSummary.trim()}`,
          `Details of Your Team Achievement in 2026 and Business Impact\n${teamAchievementImpact.trim()}`,
          `How you demonstrate BD China culture (especially on you applied category) ?\n${cultureDemonstration.trim()}`,
        ].join('\n\n'),
        projectAttachments: attachments,
      }
      const result = editing
        ? await IdeaService.updateIdea(editing.id, { ...payload, approvalVersion: editing.approvalVersion })
        : await IdeaService.createIdea(payload)
      onSubmitted(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the team nomination. Please retry.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return <Card className="dp-form-shell" p={{ base: 'lg', md: 38 }}><Stack gap="lg" id="nomination-form">
    <Title order={3}>Team nomination</Title>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {membership.isPending ? <Text role="status">Loading your team membership…</Text>
      : membership.isError ? <Alert color="red">Unable to load your team membership. <Button variant="subtle" onClick={() => void membership.refetch()}>Retry</Button></Alert>
      : team ? <>
        <Text fw={650}>Team: {team.name}</Text>
        {!isCaptain && <Alert color="blue">You have joined this team. Only the team creator who is its current captain can fill in and submit the team nomination.</Alert>}
      </> : editing ? <Alert color="orange">You are no longer the captain of this nomination’s team and cannot edit it.</Alert>
        : <Grid gutter="lg">
          <Grid.Col span={{ base: 12, sm: 6 }}><Stack>
            <Text fw={650}>Create a team</Text>
            <TextInput label="Team name" value={teamName} maxLength={100} disabled={busy} onChange={(event) => setTeamName(event.currentTarget.value)} />
            <Button variant="outline" loading={busy} onClick={() => void changeMembership('create')}>Create team</Button>
          </Stack></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}><Stack>
            <Text fw={650}>Join a team</Text>
            <Select label="Available teams" placeholder="Select a team" searchable disabled={busy}
              data={(membership.data?.teams ?? []).filter((item) => item.isOpen).map((item) => ({ value: item.id, label: item.name }))}
              value={joinTeamId} onChange={setJoinTeamId} />
            <Button variant="outline" disabled={!joinTeamId} loading={busy} onClick={() => void changeMembership('join')}>Join team</Button>
          </Stack></Grid.Col>
        </Grid>}
    {isCaptain && <>
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="NominatorName" value={metadata?.nominatorName ?? user.name} readOnly required /></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}><Select label="Award Category" required allowDeselect={false} disabled={busy}
          data={getDigitalPioneerTracks('team').map((track) => ({ value: track.value, label: track.label }))}
          value={category} onChange={(value) => { if (value) onCategoryChange(value) }} /></Grid.Col>
        <Grid.Col span={12}><TextInput label="Project Name" required value={projectName} maxLength={200} disabled={busy} onChange={(event) => setProjectName(event.currentTarget.value)} /></Grid.Col>
        <Grid.Col span={12}>
          <FileInput label="Team Photo" description="JPG, PNG or WebP; up to 50 MB per photo." required clearable
            accept={PHOTO_ACCEPT} value={photo} disabled={busy} onChange={setPhoto} error={photoError} />
          {savedPhoto && <Text size="sm">Your submitted team photo is retained unless you upload a replacement.</Text>}
          {photoPreview && <Image src={photoPreview} alt="Team photo preview" fit="contain" mah={240} mt="sm" />}
        </Grid.Col>
        <Grid.Col span={12}><Textarea label="Core Team Member" required minRows={2} disabled={busy}
          description={'Enter Outlook names separated by “;”. Only BDCN team employees may be included. 仅填写 BDCN 团队员工，请填写 Outlook name，用“;”分割。'}
          value={coreTeamMembers} onChange={(event) => setCoreTeamMembers(event.currentTarget.value)} /></Grid.Col>
      </Grid>
      <div className="dp-fieldset" translate="no"><Textarea label="Achievement Summary (≤ 200 words)" required minRows={4} disabled={busy}
        description="Summarize the achievement, the value created, and why it deserves the 2026 Digital Pioneer Award in this track."
        value={achievementSummary} error={summaryWords > 200 ? 'Maximum 200 words.' : undefined}
        onChange={(event) => setAchievementSummary(event.currentTarget.value)} />
        <Text size="xs" c={summaryWords > 200 ? 'red' : 'dimmed'} aria-live="polite">{summaryWords} / 200 words</Text>
      </div>
      <div className="dp-fieldset" translate="no"><Textarea label="Details of Your Team Achievement in 2026 and Business Impact" required minRows={4} disabled={busy}
        description="What were the measurable outcomes in 2026? including financial figures"
        value={teamAchievementImpact} onChange={(event) => setTeamAchievementImpact(event.currentTarget.value)} /></div>
      <div className="dp-fieldset" translate="no"><Textarea label="How you demonstrate BD China culture (especially on you applied category) ?" required minRows={4} disabled={busy}
        description="Describe how the /team demonstrated the culture pillar of this track."
        value={cultureDemonstration} onChange={(event) => setCultureDemonstration(event.currentTarget.value)} /></div>
      <div className="dp-fieldset" translate="no"><FileInput label="Attachment" clearable disabled={busy} accept={documentAccept}
        description="Optional supplementary materials; up to 50 MB per document. PDF, text, Markdown or ZIP."
        value={document} onChange={setDocument} error={documentError} />
        {savedDocuments.map((item) => <Text key={item.storageKey ?? item.url} size="sm">Retained attachment: {item.name}</Text>)}
      </div>
      <Group justify="flex-end"><Button className="dp-primary-button" loading={busy}
        disabled={!canSubmit || summaryWords > 200 || Boolean(photoError || documentError)} onClick={() => void submit()}>
        {editing ? 'Resubmit nomination' : 'Submit nomination'}
      </Button></Group>
    </>}
  </Stack></Card>
}
