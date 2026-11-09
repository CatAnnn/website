import { Alert, Button, Card, FileInput, Grid, Group, Image, Modal, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { getDigitalPioneerTracks } from '../../config/digitalPioneer'
import { IdeaService, type CreateIdeaInput, type Idea, type ProjectAttachment } from '../../services/ideaService'
import { PHOTO_ACCEPT, StorageService, validatePersonalPhoto } from '../../services/storageService'
import type { AuthUser } from '../../store/authStore'
import { CoreTeamMembersInput } from './CoreTeamMembersInput'
import { NominationDraftStore, nominationDraftKey, type NominationDraft } from '../../services/nominationDraftStore'
import { LocalNominationAttachment } from './LocalNominationAttachment'
import { NominationEvidence } from './NominationEvidence'

interface Props {
  user: AuthUser
  hackathonId: string
  category: string
  onCategoryChange: (category: string) => void
  canSubmit: boolean
  editing?: Idea | null
  onSubmitted: (idea: Idea, draftWarning?: string) => void
}

const documentAccept = '.pdf,.txt,.md,.zip'
const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0
const validateTeamPhoto = (file: File | null) => file && file.size > 10 * 1024 * 1024
  ? 'Team photo exceeds 10 MB. Please choose a smaller photo.' : validatePersonalPhoto(file)

interface TeamDraft {
  category: string
  projectName: string
  coreTeamMembers: string
  achievementSummary: string
  teamAchievementImpact: string
  cultureDemonstration: string
  photo: File | null
  document: File | null
  approvalVersion?: number
}

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
  const [reviewOpened, setReviewOpened] = useState(false)
  const [savedDraft, setSavedDraft] = useState<NominationDraft<TeamDraft> | null>(null)
  const [draftLoading, setDraftLoading] = useState(true)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftMessage, setDraftMessage] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const draftKey = nominationDraftKey({ userId: user.id, hackathonId, nominationType: 'team', editId: editing?.id })
  const savedPhoto = editing?.projectAttachments?.find((item) => item.type === 'screenshot')
  const savedDocuments = editing?.projectAttachments?.filter((item) => item.type === 'document') ?? []
  const photoError = validateTeamPhoto(photo)
  const documentError = document && (document.size === 0 ? 'The selected attachment is empty.'
    : document.size >= 20 * 1024 * 1024 ? 'Attachment must be less than 20 MB.' : null)
  const summaryWords = countWords(achievementSummary)

  useEffect(() => {
    let active = true
    setDraftLoading(true)
    setSavedDraft(null)
    void NominationDraftStore.load<TeamDraft>(draftKey).then((draft) => {
      if (active) setSavedDraft(draft)
    }).catch(() => {
      if (active) setDraftError('Unable to read your saved draft. You can continue editing and retry Save Draft.')
    }).finally(() => { if (active) setDraftLoading(false) })
    return () => { active = false }
  }, [draftKey])

  const saveDraft = async () => {
    if (draftSaving || draftLoading || busy) return
    setDraftSaving(true)
    setDraftError(null)
    try {
      const draft = await NominationDraftStore.save<TeamDraft>(draftKey, {
        category, projectName, coreTeamMembers, achievementSummary, teamAchievementImpact, cultureDemonstration,
        photo, document, approvalVersion: editing?.approvalVersion,
      })
      setSavedDraft(draft)
      setDraftMessage('Draft saved in this browser. You can leave and restore it from this form later.')
    } catch {
      setDraftError('Unable to save your draft. Check available browser storage and retry before leaving.')
    } finally { setDraftSaving(false) }
  }

  const restoreDraft = () => {
    if (!savedDraft || busy || draftSaving) return
    const draft = savedDraft.data
    // 编辑退回提名时保留最新审批版本，旧版本草稿不能覆盖新审核结果。
    if (editing && draft.approvalVersion !== editing.approvalVersion) {
      setDraftError('This nomination has changed since the draft was saved. Discard the old draft and use the latest nomination.')
      return
    }
    if (!editing) onCategoryChange(draft.category)
    setProjectName(draft.projectName)
    setCoreTeamMembers(draft.coreTeamMembers)
    setAchievementSummary(draft.achievementSummary)
    setTeamAchievementImpact(draft.teamAchievementImpact)
    setCultureDemonstration(draft.cultureDemonstration)
    setPhoto(draft.photo)
    setDocument(draft.document)
    setDraftError(null)
    setDraftMessage('Draft restored. Review your information before submitting.')
  }

  const discardDraft = async () => {
    if (draftSaving || busy) return
    setDraftSaving(true)
    try {
      await NominationDraftStore.remove(draftKey)
      setSavedDraft(null)
      setDraftError(null)
      setDraftMessage('Saved draft deleted. Your current form is unchanged.')
    } catch { setDraftError('Unable to delete the saved draft. Please retry.') }
    finally { setDraftSaving(false) }
  }

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

  const submit = async (confirmed = false) => {
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
    // 首次点击只展示确认页，第二次确认才沿用原上传和提交审批流程。
    if (!confirmed) { setReviewOpened(true); return }
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
      let draftWarning: string | undefined
      // 提交已成功时，草稿清理失败只提示用户，不重复提交提名。
      await NominationDraftStore.remove(draftKey).catch(() => {
        draftWarning = 'Your nomination was submitted, but its saved draft could not be removed. Delete that draft when you return to the nomination page.'
      })
      setReviewOpened(false)
      onSubmitted(result, draftWarning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the team nomination. Please retry.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return <Card className="dp-form-shell dp-team-nomination-form" p={{ base: 'lg', md: 38 }}><Stack gap="lg" id="nomination-form">
    <Title order={3}>Team Nomination</Title>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {draftError && <Alert color="red" c="white" styles={{ message: { color: '#fff' } }}>{draftError}</Alert>}
    {draftMessage && <Alert color="blue" c="white" role="status" styles={{ message: { color: '#fff' } }}>{draftMessage}</Alert>}
    {savedDraft && <Alert color="blue" c="white" title="Saved Draft Available" styles={{ title: { color: '#fff' }, message: { color: '#fff' } }}>
      <Stack gap="xs"><Text c="white" size="sm">Saved {new Date(savedDraft.savedAt).toLocaleString()}. Restore it to continue editing.</Text>
        <Group><Button variant="light" c="white" disabled={busy || draftSaving} onClick={restoreDraft}>Restore Draft</Button>
          <Button variant="subtle" c="white" disabled={busy || draftSaving} onClick={() => void discardDraft()}>Delete Draft</Button></Group>
      </Stack>
    </Alert>}
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
      <div className="dp-fieldset" translate="no"><Textarea label="How You Demonstrate BD China Culture (Especially On You Applied Category)?" required autosize minRows={4} resize="vertical" disabled={busy}
        placeholder="Describe how the /team demonstrated the culture pillar of this track."
        value={cultureDemonstration} onChange={(event) => setCultureDemonstration(event.currentTarget.value)} /></div>
      <div className="dp-fieldset" translate="no"><FileInput className="dp-team-file-input dp-team-attachment" label="Attachment" clearable disabled={busy} accept={documentAccept}
        placeholder="Optional supplementary materials, document size less than 20 MB"
        value={document} onChange={setDocument} error={documentError} />
        {document && !documentError && <LocalNominationAttachment file={document} />}
        {!document && savedDocuments.map((item) => <Stack key={item.storageKey ?? item.url} gap="xs"><Text size="sm">Retained attachment: {item.name}</Text><NominationEvidence attachment={item} /></Stack>)}
      </div>
      <Group justify="flex-end"><Button variant="light" c="white" loading={draftSaving} disabled={busy || draftLoading} onClick={() => void saveDraft()}>Save Draft</Button>
        <Button className="dp-primary-button" loading={busy}
        disabled={!canSubmit || summaryWords > 200 || Boolean(photoError || documentError)} onClick={() => void submit()}>
        {editing ? 'Resubmit nomination' : 'Submit nomination'}
      </Button></Group>
      <Modal opened={reviewOpened} onClose={() => { if (!busy) setReviewOpened(false) }} title="Review Team Nomination" size="lg" centered
        closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy} className="dp-nomination-review"
        styles={{ content: { background: '#071b3b', color: '#fff' }, header: { background: '#071b3b', color: '#fff' }, title: { color: '#fff' } }}>
        <Stack gap="lg" style={{ minWidth: 0 }}>
          <Text c="white">Review all information below. Confirm to submit it to your Nominating HoD.</Text>
          {error && <Alert color="red" c="white" role="alert" styles={{ message: { color: '#fff' } }}>{error}</Alert>}
          <Title order={3} c="white">{getDigitalPioneerTracks('team').find((track) => track.value === category)?.label ?? category}</Title>
          <Text c="white"><strong>Name:</strong> {metadata?.nominatorName ?? user.name}</Text>
          <Text c="white" style={{ overflowWrap: 'anywhere' }}><strong>Project Name:</strong> {projectName}</Text>
          {photoPreview && <Image src={photoPreview} alt="Team nomination photo" fit="contain" w="100%" h={280} style={{ display: 'block', position: 'static', maxWidth: '100%' }} />}
          {[
            ['Core Team Member', coreTeamMembers],
            ['Achievement Summary', achievementSummary],
            ['Details Of Your Team Achievement In 2026 And Business Impact', teamAchievementImpact],
            ['How You Demonstrate BD China Culture', cultureDemonstration],
          ].map(([label, value]) => <Stack gap="xs" key={label} style={{ minWidth: 0 }}><Title order={4} c="white">{label}</Title><Text c="white" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</Text></Stack>)}
          {document ? <LocalNominationAttachment file={document} /> : savedDocuments.map((item) => <NominationEvidence key={item.storageKey ?? item.url} attachment={item} />)}
          <Group justify="flex-end"><Button variant="light" c="white" disabled={busy} onClick={() => setReviewOpened(false)}>Back To Edit</Button>
            <Button loading={busy} disabled={!canSubmit || busy} onClick={() => void submit(true)}>Confirm And Submit</Button></Group>
        </Stack>
      </Modal>
  </Stack></Card>
}
