import { Alert, Button, Card, FileInput, Grid, Group, Image, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { getDigitalPioneerTracks } from '../../config/digitalPioneer'
import { IdeaService, type CreateIdeaInput, type Idea, type ProjectAttachment } from '../../services/ideaService'
import { PHOTO_ACCEPT, StorageService, validatePersonalPhoto } from '../../services/storageService'
import type { AuthUser } from '../../store/authStore'
import { CoreTeamMembersInput } from './CoreTeamMembersInput'

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
const validateTeamPhoto = (file: File | null) => file && file.size > 10 * 1024 * 1024
  ? 'Team photo exceeds 10 MB. Please choose a smaller photo.' : validatePersonalPhoto(file)

export function TeamNominationForm({ user, hackathonId, category, onCategoryChange, canSubmit, editing, onSubmitted }: Props) {
  const metadata = editing?.projectAttachments?.find((item) => item.type === 'nomination')
  const [projectName, setProjectName] = useState(metadata?.projectName ?? '')
  const [coreTeamMembers, setCoreTeamMembers] = useState(metadata?.coreTeamMembers ?? '')
  const [achievementSummary, setAchievementSummary] = useState(metadata?.achievementSummary ?? '')
  const [teamAchievementImpact, setTeamAchievementImpact] = useState(metadata?.teamAchievementImpact ?? '')
  const [cultureDemonstration, setCultureDemonstration] = useState(metadata?.cultureDemonstration ?? '')
  const [photo, setPhoto] = useState<File | null>(null)
  const [document, setDocument] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const savedPhoto = editing?.projectAttachments?.find((item) => item.type === 'screenshot')
  const savedDocuments = editing?.projectAttachments?.filter((item) => item.type === 'document') ?? []
  const photoError = validateTeamPhoto(photo)
  const documentError = document && (document.size === 0 ? 'The selected attachment is empty.'
    : document.size >= 20 * 1024 * 1024 ? 'Attachment must be less than 20 MB.' : null)
  const summaryWords = countWords(achievementSummary)

  useEffect(() => {
    let active = true
    if (photo && !validateTeamPhoto(photo)) {
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

  const submit = async () => {
    if (!canSubmit || busyRef.current) return
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
        title: projectName.trim(), hackathonId, teamId: editing?.teamId ?? undefined, category, status: 'submitted', tags: [],
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

  return <Card className="dp-form-shell dp-team-nomination-form" p={{ base: 'lg', md: 38 }}><Stack gap="lg" id="nomination-form">
    <Title order={3}>Team nomination</Title>
    {error && <Alert color="red" role="alert">{error}</Alert>}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Nominator Name" value={metadata?.nominatorName ?? user.name} readOnly required /></Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}><Select label="Award Category" required allowDeselect={false} disabled={busy || Boolean(editing)}
          data={getDigitalPioneerTracks('team').map((track) => ({ value: track.value, label: track.label }))}
          value={category} onChange={(value) => { if (value) onCategoryChange(value) }} /></Grid.Col>
        <Grid.Col span={12}><TextInput label="Project Name" required value={projectName} maxLength={200} disabled={busy} onChange={(event) => setProjectName(event.currentTarget.value)} /></Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <FileInput className="dp-team-file-input" label="Team Photo" placeholder="JPG, PNG or WebP; up to 10 MB per photo." required clearable
            accept={PHOTO_ACCEPT} value={photo} disabled={busy} onChange={setPhoto} error={photoError} />
          {savedPhoto && <Text size="sm">Your submitted team photo is retained unless you upload a replacement.</Text>}
          {photoPreview && <Image src={photoPreview} alt="Team photo preview" fit="contain" mah={240} mt="sm" />}
        </Grid.Col>
        <Grid.Col span={12}><CoreTeamMembersInput disabled={busy}
          value={coreTeamMembers} onChange={setCoreTeamMembers} /></Grid.Col>
      </Grid>
      <div className="dp-fieldset" translate="no"><Textarea label="Achievement Summary (≤ 200 words)" required autosize minRows={8} resize="vertical" disabled={busy}
        placeholder="Summarize the achievement, the value created, and why it deserves the 2026 Digital Pioneer Award in this track."
        value={achievementSummary} error={summaryWords > 200 ? 'Maximum 200 words.' : undefined}
        onChange={(event) => setAchievementSummary(event.currentTarget.value)} />
      </div>
      <div className="dp-fieldset" translate="no"><Textarea label="Details of Your Team Achievement in 2026 and Business Impact" required autosize minRows={4} resize="vertical" disabled={busy}
        placeholder="What were the measurable outcomes in 2026? including financial figures"
        value={teamAchievementImpact} onChange={(event) => setTeamAchievementImpact(event.currentTarget.value)} /></div>
      <div className="dp-fieldset" translate="no"><Textarea label="How you demonstrate BD China culture (especially on you applied category) ?" required autosize minRows={4} resize="vertical" disabled={busy}
        placeholder="Describe how the /team demonstrated the culture pillar of this track."
        value={cultureDemonstration} onChange={(event) => setCultureDemonstration(event.currentTarget.value)} /></div>
      <div className="dp-fieldset" translate="no"><FileInput className="dp-team-file-input dp-team-attachment" label="Attachment" clearable disabled={busy} accept={documentAccept}
        placeholder="Optional supplementary materials, document size less than 20 MB"
        value={document} onChange={setDocument} error={documentError} />
        {savedDocuments.map((item) => <Text key={item.storageKey ?? item.url} size="sm">Retained attachment: {item.name}</Text>)}
      </div>
      <Group justify="flex-end"><Button className="dp-primary-button" loading={busy}
        disabled={!canSubmit || summaryWords > 200 || Boolean(photoError || documentError)} onClick={() => void submit()}>
        {editing ? 'Resubmit nomination' : 'Submit nomination'}
      </Button></Group>
  </Stack></Card>
}
