import {
  Container,
  Stack,
  Title,
  Text,
  Card,
  Group,
  Badge,
  Button,
  Grid,
  ActionIcon,
  Avatar,
  ThemeIcon,
  Select,
  TextInput,
  SimpleGrid,
  Modal,
  CloseButton,
  Center,
  Alert,
  Image,
  FileInput,
  Input,
  Textarea,
  UnstyledButton,
  Checkbox,
  Slider,
} from '@mantine/core'
import {
  IconTrophy,
  IconThumbUp,
  IconThumbUpFilled,
  IconBrandGithub,
  IconWorldWww,
  IconSearch,
  IconUser,
  IconExternalLink,
  IconUpload,
  IconGavel,
  IconArrowRight,
  IconInfoCircle,
  IconPhoto,
  IconCheck,
  IconTrash,
} from '@tabler/icons-react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useLanguage } from '../contexts/LanguageContext'
import { notifications } from '@mantine/notifications'
import { getAllPages } from '../services/pagination'
import { ApiError } from '../lib/apiClient'
import { HackathonService } from '../services/hackathonService'
import { PublicAwardService, type AwardSummary } from '../services/publicAwardService'
import { IdeaService, type Idea, type CreateIdeaInput, type ProjectAttachment } from '../services/ideaService'
import { useRealtime } from '../hooks/useRealtime'
import { useNominationEligibility } from '../hooks/useNominationEligibility'
import { NominationProgress } from '../components/DigitalPioneer/NominationProgress'
import { validateNominationPdf } from '../services/storageService'
import { NominationEvidence } from '../components/DigitalPioneer/NominationEvidence'
import { LocalNominationAttachment } from '../components/DigitalPioneer/LocalNominationAttachment'
import { NominationDraftStore, nominationDraftKey, type NominationDraft } from '../services/nominationDraftStore'
import { TeamNominationForm } from '../components/DigitalPioneer/TeamNominationForm'
import { useNominationType } from '../hooks/useNominationType'
import { ProfileService } from '../services/profileService'
import { StorageService, MAX_UPLOAD_BYTES, PHOTO_ACCEPT, validatePersonalPhoto } from '../services/storageService'
import { TeamService } from '../services/teamService'
import { JudgingService } from '../services/judgingService'
import {
  DIGITAL_PIONEER_TRACKS,
  getDigitalPioneerTracks,
  normalizeDigitalPioneerTrack,
} from '../config/digitalPioneer'
import { AwardCriteriaList } from '../components/AwardCriteriaList'
import './DigitalPioneer.css'

interface Project {
  id: string
  title: string
  description: string
  nominee_name: string
  nominee_org_code: string
  team_members: Array<{
    id: string
    name: string
    avatar?: string
    role?: string
  }>
  hackathon_id: string
  category: string
  technologies: string[]
  github_url?: string
  demo_url?: string
  video_url?: string
  images: string[]
  votes: number
  user_vote?: boolean
  nomination_type: 'individual' | 'team'
  documents?: ProjectAttachment[]
  status: 'draft' | 'submitted' | 'in-progress' | 'completed'
  created_at: string
  submission_date: string
}

interface ProjectFilters {
  search: string
  category: string
  department: string
}

interface ProjectUploadForm {
  hackathonId: string
  executiveSummary: string
  achievementImpact: string
  cultureDemonstration: string
  category: string
  technologies: string
}

interface IndividualNominationDraft {
  form: ProjectUploadForm
  photo: File | null
  document: File | null
  approvalVersion?: number
}

const emptyUploadForm = (): ProjectUploadForm => ({
  hackathonId: '',
  executiveSummary: '',
  achievementImpact: '',
  cultureDemonstration: '',
  category: '',
  technologies: '',
})

const parseNominationTags = (value: string): string[] =>
  [...new Set(value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean))]

const tagHint = 'Add up to 5 tags, separated by 、, ， or commas (,).'

const nominationHeadings = [
  'Executive Summary (The Elevator Pitch)',
  'Details Of Your Core Achievement In 2026 And Business Impact (Including Financial Figures)',
  'How You Demonstrate BD China Culture (Especially On You Applied Category) ?',
]

function parseNominationDescription(description: string, nominationType: 'individual' | 'team' = 'individual') {
  const sections: Array<{ heading: string; body: string }> = []
  let heading = ''
  let lines: string[] = []
  for (const line of description.split(/\r?\n/)) {
    const label = line.trim().replace(/^\*\*|\*\*$/g, '')
    const index = /^Executive Summary(?: \(The Elevator Pitch\))?$/i.test(label) ? 0
      : label.toLowerCase() === nominationHeadings[1].toLowerCase() ? 1
      : /^How you demonstrate (?:Bosch|BD) China culture \(especially (?:in your|on you) applied category\)\s*\??$/i.test(label) ? 2
      : -1
    // 团队历史提交使用不同的固定标题，仅在详情中规范显示，不改写保存的正文。
    const teamHeading = nominationType === 'team'
      ? /^Achievement Summary$/i.test(label) ? 'Achievement Summary'
        : /^Details of Your Team Achievement in 2026 and Business Impact$/i.test(label) ? 'Details Of Your Team Achievement In 2026 And Business Impact'
        : /^How you demonstrate (?:Bosch|BD) China culture(?: \(especially (?:in your|on you) applied category\))?\s*\??$/i.test(label) ? 'How You Demonstrate BD China Culture'
        : ''
      : ''
    if (teamHeading || index >= 0) {
      if (heading || lines.join('\n').trim()) sections.push({ heading, body: lines.join('\n').trim() })
      heading = teamHeading || nominationHeadings[index]
      lines = []
    } else {
      lines.push(line)
    }
  }
  if (heading || lines.join('\n').trim()) sections.push({ heading, body: lines.join('\n').trim() })
  return sections
}

function nominationSummary(description: string) {
  const sections = parseNominationDescription(description)
  return sections.find((section) => section.heading === nominationHeadings[0])?.body
    ?? sections.find((section) => !section.heading)?.body ?? ''
}

function NomineePhoto({ src, name }: { src: string; name: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!container.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    // Limit preloading to the next row instead of downloading every original photo.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={container} className="dp-candidate-photo" style={{ position: 'relative' }}>
      {visible && <Image key={attempt} src={src} alt={`${name} nomination`} fit="contain"
        decoding="async" w="100%" h="100%"
        onLoad={() => setStatus('loaded')} onError={() => setStatus('error')}
        style={{ visibility: status === 'loaded' ? 'visible' : 'hidden' }} />}
      {status !== 'loaded' && <Stack gap="xs" align="center" justify="center"
        style={{ position: 'absolute', inset: 0 }}>
        <IconUser size={24} aria-hidden="true" />
        <Text size="sm" role="status">{status === 'error' ? 'Photo unavailable' : 'Loading photo…'}</Text>
        {status === 'error' && <Button size="compact-xs" variant="subtle" onClick={() => {
          setStatus('loading')
          setAttempt((current) => current + 1)
        }}>Retry photo</Button>}
      </Stack>}
    </div>
  )
}

function usePhotoUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return file ? url : null
}

function RetainedNominationPhoto({ attachment }: { attachment: ProjectAttachment }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)
    // 编辑预览使用现有照片的新签名链接，不重新上传或改变附件记录。
    const request = attachment.storageKey
      ? StorageService.getPresignedUrl('project-attachments', attachment.storageKey)
      : Promise.resolve(attachment.url)
    void Promise.resolve(request).then((value) => { if (active) setUrl(value || null) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attachment.storageKey, attachment.url])
  return <Stack gap="xs">
    <Text c="white">{attachment.name || 'Submitted Photo'}</Text>
    {url && !failed ? <Image src={url} alt="Retained Nomination Photo" fit="contain" w="100%" h={280} onError={() => setFailed(true)} />
      : <Text c="white" role="status">{failed ? 'The retained photo could not be previewed. Its saved file is unchanged.' : 'Loading retained photo…'}</Text>}
  </Stack>
}

function PersonalPhotoCrop({ file, language, onConfirm, onClose }: {
  file: File
  language: string
  onConfirm: (file: File) => void
  onClose: () => void
}) {
  const source = usePhotoUrl(file)
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const zh = language === 'zh'
  // The same 3:4 viewport and offsets are used for preview and exported pixels.
  const width = 240
  const height = 320
  const scale = dimensions.width ? Math.max(width / dimensions.width, height / dimensions.height) * zoom : 1
  const limitX = Math.max(0, (dimensions.width * scale - width) / 2)
  const limitY = Math.max(0, (dimensions.height * scale - height) / 2)
  const x = Math.max(-limitX, Math.min(limitX, position.x))
  const y = Math.max(-limitY, Math.min(limitY, position.y))

  const confirmCrop = async () => {
    if (!imageRef.current || !dimensions.width || saving) return
    setSaving(true)
    setError(false)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 600
      canvas.height = 800
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.drawImage(imageRef.current,
        (dimensions.width * scale / 2 - width / 2 - x) / scale,
        (dimensions.height * scale / 2 - height / 2 - y) / scale,
        width / scale, height / scale, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Crop failed')), 'image/webp', 0.85)
      })
      const extension = blob.type === 'image/webp' ? 'webp' : 'png'
      onConfirm(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-cropped.${extension}`, { type: blob.type }))
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened onClose={() => { if (!saving) onClose() }} title={zh ? '裁剪个人照片' : 'Crop Personal Photo'} centered size="sm"
      closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
      <Stack>
        <Text size="sm">{zh ? '拖动照片调整位置，使用滑块缩放（3:4 证件照比例）。也可用方向键移动照片。' : 'Drag to reposition and use the slider to zoom (3:4 portrait). Arrow keys also move the photo.'}</Text>
        <div
          role="group"
          aria-label={zh ? '照片裁剪区域' : 'Photo crop area'}
          tabIndex={0}
          style={{ width, height, maxWidth: '100%', margin: '0 auto', position: 'relative', overflow: 'hidden', background: '#111', touchAction: 'none', cursor: saving ? 'wait' : 'move', borderRadius: 4 }}
          onPointerDown={(event) => {
            if (saving || !dimensions.width || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.focus()
            drag.current = { x: event.clientX, y: event.clientY, left: x, top: y }
          }}
          onPointerMove={(event) => {
            if (!drag.current || saving) return
            setPosition({
              x: Math.max(-limitX, Math.min(limitX, drag.current.left + event.clientX - drag.current.x)),
              y: Math.max(-limitY, Math.min(limitY, drag.current.top + event.clientY - drag.current.y)),
            })
          }}
          onPointerUp={() => { drag.current = null }}
          onPointerCancel={() => { drag.current = null }}
          onLostPointerCapture={() => { drag.current = null }}
          onKeyDown={(event) => {
            if (saving || !event.key.startsWith('Arrow')) return
            event.preventDefault()
            setPosition({
              x: Math.max(-limitX, Math.min(limitX, x + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0))),
              y: Math.max(-limitY, Math.min(limitY, y + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0))),
            })
          }}
        >
          {source && <img ref={imageRef} src={source} alt={zh ? '待裁剪照片' : 'Photo to crop'} draggable={false}
            onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => { setDimensions({ width: 0, height: 0 }); setError(true) }}
            style={{ position: 'absolute', width: dimensions.width * scale, height: dimensions.height * scale, maxWidth: 'none', left: (width - dimensions.width * scale) / 2 + x, top: (height - dimensions.height * scale) / 2 + y, pointerEvents: 'none', userSelect: 'none' }}
          />}
        </div>
        <Text size="sm">{zh ? '缩放' : 'Zoom'}</Text>
        <Slider thumbLabel={zh ? '照片缩放' : 'Photo zoom'} min={1} max={3} step={0.01} value={zoom} disabled={saving || !dimensions.width}
          onChange={(value) => { setPosition({ x, y }); setZoom(value) }} label={(value) => `${value.toFixed(1)}×`} />
        {error && <Text c="red" size="sm" role="alert">{zh ? '无法读取或裁剪照片，请重试或重新选择照片。' : 'Unable to read or crop the photo. Please retry or choose another photo.'}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>{zh ? '取消' : 'Cancel'}</Button>
          <Button onClick={() => void confirmCrop()} loading={saving} disabled={!dimensions.width}>{zh ? '确认裁剪' : 'Confirm crop'}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export function ProjectShowcase({ nominationMode = false, managementMode = false }: { nominationMode?: boolean; managementMode?: boolean }) {
  const { isConnected, subscribeToHackathonUpdates } = useRealtime()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const { language } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [preferredNominationType, setNominationType] = useNominationType()
  const [votingType, setVotingType] = useState<'individual' | 'team'>(() => searchParams.get('type') === 'individual' ? 'individual' : 'team')
  const [submitting, setSubmitting] = useState(false)
  const [recordToDelete, setRecordToDelete] = useState<Project | null>(null)
  const [deletingRecord, setDeletingRecord] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const ballotBusy = useRef(false)
  const recordsOpened = searchParams.get('view') === 'voting-records'
  const closeVotingRecords = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('view')
      return next
    }, { replace: true })
  }
  const nomineeToOpen = searchParams.get('nominee')
  const eligibility = useNominationEligibility()
  const canNominate = eligibility.data?.canSubmit === true
  const ownNominations = useQuery({
    queryKey: ['my-nomination-slots', user?.id], queryFn: () => IdeaService.getMyNominations(),
    enabled: nominationMode && Boolean(user), staleTime: 0, retry: false,
  })
  const editId = nominationMode ? searchParams.get('edit') : null
  const [editingNomination, setEditingNomination] = useState<Idea | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [submittedNomination, setSubmittedNomination] = useState<Idea | null>(null)
  const canDelete = managementMode && user?.role === 'admin'
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingDeletion, setPendingDeletion] = useState<Project[]>([])
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)

  const loadSequence = useRef(0)
  const restoredNominee = useRef<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [cartOpened, setCartOpened] = useState(false)
  const [locateRequest, setLocateRequest] = useState<{ id: string } | null>(null)
  const closeVoteCart = () => {
    setCartOpened(false)
    // On mobile the trigger must be visible again before it can receive focus.
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.dp-vote-cart-button')?.focus({ preventScroll: true })
    })
  }
  const [voteError, setVoteError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [modalOpened, setModalOpened] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadBusy = useRef(false)
  const [individualPreviewOpened, setIndividualPreviewOpened] = useState(false)
  const [individualDraft, setIndividualDraft] = useState<NominationDraft<IndividualNominationDraft> | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [submissionDraftWarning, setSubmissionDraftWarning] = useState<string | null>(null)
  const [teamDraftCategory, setTeamDraftCategory] = useState<string | null>(null)
  const [hackathons, setHackathons] = useState<AwardSummary[]>([])
  const [projectImage, setProjectImage] = useState<File | null>(null)
  const [individualDocument, setIndividualDocument] = useState<File | null>(null)
  const [photoToCrop, setPhotoToCrop] = useState<File | null>(null)
  const photoPreview = usePhotoUrl(projectImage && !validatePersonalPhoto(projectImage) ? projectImage : null)
  const [uploadForm, setUploadForm] = useState<ProjectUploadForm>(emptyUploadForm)
  const individualDraftKey = user && uploadForm.hackathonId ? nominationDraftKey({
    userId: user.id, hackathonId: uploadForm.hackathonId, nominationType: 'individual', editId,
  }) : null
  const currentDraftKey = useRef(individualDraftKey)
  const draftUserId = user?.id
  currentDraftKey.current = individualDraftKey
  const individualDraftActive = nominationMode && (editingNomination
    ? editingNomination.projectAttachments?.find((item) => item.type === 'nomination')?.nominationType ?? 'individual'
    : preferredNominationType) === 'individual'
  useEffect(() => {
    setIndividualDraft(null)
    setDraftNotice(null)
    if (!individualDraftActive || !individualDraftKey) return
    let active = true
    void NominationDraftStore.load<IndividualNominationDraft>(individualDraftKey).then((draft) => {
      if (active) setIndividualDraft(draft)
    }).catch(() => { if (active) setDraftNotice('Saved drafts are unavailable in this browser. Your form is still editable.') })
    return () => { active = false }
  }, [individualDraftActive, individualDraftKey])

  useEffect(() => {
    setTeamDraftCategory(null)
    if (!nominationMode || !draftUserId || !uploadForm.hackathonId || preferredNominationType !== 'team' || uploadForm.category || editId) return
    let active = true
    const key = nominationDraftKey({ userId: draftUserId, hackathonId: uploadForm.hackathonId, nominationType: 'team' })
    void NominationDraftStore.load<{ category: string }>(key).then((draft) => {
      if (active && draft && DIGITAL_PIONEER_TRACKS.some((track) => track.value === draft.data.category)) setTeamDraftCategory(draft.data.category)
    }).catch(() => undefined)
    return () => { active = false }
  }, [nominationMode, draftUserId, uploadForm.hackathonId, uploadForm.category, preferredNominationType, editId])

  const saveIndividualDraft = async () => {
    if (!individualDraftKey || savingDraft || uploading) return
    const key = individualDraftKey
    setSavingDraft(true)
    try {
      const saved = await NominationDraftStore.save<IndividualNominationDraft>(key, {
        form: { ...uploadForm }, photo: projectImage, document: individualDocument,
        approvalVersion: editingNomination?.approvalVersion,
      })
      if (currentDraftKey.current === key) {
        setIndividualDraft(saved)
        setDraftNotice('Draft saved on this browser. You can reopen it when you return.')
      }
    } catch {
      if (currentDraftKey.current === key) setDraftNotice('Unable to save the draft. Keep this page open and try again.')
    } finally { setSavingDraft(false) }
  }

  const restoreIndividualDraft = () => {
    if (!individualDraft || uploading || (editId && !editingNomination)) return
    if (editId && individualDraft.data.approvalVersion !== editingNomination?.approvalVersion) {
      setDraftNotice('This draft belongs to an earlier revision. Keep the current nomination or discard the draft.')
      return
    }
    // 只恢复当前账户、活动和提名版本的内容，不替换服务器审批状态。
    setUploadForm(individualDraft.data.form)
    setProjectImage(individualDraft.data.photo)
    setIndividualDocument(individualDraft.data.document)
    setPhotoToCrop(null)
    setIndividualPreviewOpened(false)
    setDraftNotice('Draft restored. Review the information before submitting.')
  }

  const discardIndividualDraft = async () => {
    if (!individualDraftKey || savingDraft || uploading) return
    const key = individualDraftKey
    setSavingDraft(true)
    try {
      await NominationDraftStore.remove(key)
      if (currentDraftKey.current === key) { setIndividualDraft(null); setDraftNotice('Saved draft removed. Your current form is unchanged.') }
    } catch {
      if (currentDraftKey.current === key) setDraftNotice('Unable to remove the saved draft. Please try again.')
    } finally { setSavingDraft(false) }
  }
  useEffect(() => {
    if (!editId || !user) return
    let active = true
    setEditError(null)
    setEditingNomination(null)
    void IdeaService.getIdea(editId).then((idea) => {
      if (!active) return
      if (idea.createdBy !== user.id || idea.approvalStatus !== 'rejected') throw new Error('Only your rejected nominations can be revised here.')
      const sections = parseNominationDescription(idea.description)
      setEditingNomination(idea)
      setUploadForm({
        hackathonId: idea.hackathonId,
        category: idea.category,
        executiveSummary: sections.find((section) => section.heading === nominationHeadings[0])?.body ?? '',
        achievementImpact: sections.find((section) => section.heading === nominationHeadings[1])?.body ?? '',
        cultureDemonstration: sections.find((section) => section.heading === nominationHeadings[2])?.body ?? '',
        technologies: idea.tags.join(', '),
      })
    }).catch((error) => { if (active) setEditError(error instanceof Error ? error.message : 'Unable to load your nomination.') })
    return () => { active = false }
  }, [editId, user])
  const [assignedJudgeHackathons, setAssignedJudgeHackathons] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<ProjectFilters>({
    search: '',
    category: '',
    department: '',
  })

  const loadProjects = useCallback(async () => {
      const sequence = ++loadSequence.current
      setLoading(true)
      setLoadError(false)
      try {
        if (!user) {
          const awards = await getAllPages((page) => PublicAwardService.getAwards(page))
          if (sequence !== loadSequence.current) return
          setHackathons(awards)
          const nominations = await Promise.all(awards.map((award) => getAllPages((page) => PublicAwardService.getNominations(award.id, page))))
          if (sequence !== loadSequence.current) return
          setProjects(nominations.flat().map((nomination) => ({ ...nomination, technologies: parseNominationTags(nomination.technologies.join(',')), team_members: [], user_vote: false, nomination_type: nomination.nomination_type ?? 'individual' })))
          return
        }
        const loadedHackathons = await getAllPages((page) => HackathonService.getHackathons(page, 100))
        if (sequence !== loadSequence.current) return
        setHackathons(loadedHackathons)
        const currentAward = loadedHackathons.find((award) => award.status === 'running') ?? loadedHackathons[0]
        setUploadForm((current) => current.hackathonId || loadedHackathons.length === 0
          ? current
          : { ...current, hackathonId: currentAward.id })

        // Share requests within this refresh only, so votes and account changes stay fresh.
        const profiles = new Map<string, ReturnType<typeof ProfileService.getProfile>>()
        const imageUrls = new Map<string, Promise<string>>()
        const imageUpdates: Array<Promise<{ id: string; images: string[] }>> = []
        const getProfile = (id: string) => {
          let request = profiles.get(id)
          if (!request) {
            request = ProfileService.getProfile(id)
            profiles.set(id, request)
          }
          return request.catch(() => null)
        }
        const getImageUrl = (key: string) => {
          let request = imageUrls.get(key)
          if (!request) {
            request = StorageService.getPresignedUrl('project-attachments', key)
            imageUrls.set(key, request)
          }
          return request
        }

        const hackathonData = await Promise.all(loadedHackathons.map(async (hackathon) => {
          const [ideasPage, teams] = await Promise.all([
            getAllPages((page) => IdeaService.getIdeas(hackathon.id, page, 100)),
            TeamService.getTeams(hackathon.id),
          ])

          const usedTeamIds = new Set(ideasPage.map((idea) => idea.teamId))
          const teamsById = new Map(teams.map((team) => [team.id, team]))
          const teamsWithMembers = await Promise.all(teams.filter((team) => usedTeamIds.has(team.id)).map(async (team) => ({
            team,
            members: await TeamService.getTeamMembers(team.id).catch(() => []),
          })))
          const membersByTeam = new Map(teamsWithMembers.map(({ team, members }) => [team.id, members]))

          const projectList = await Promise.all(ideasPage.map(async (idea): Promise<Project> => {
            const nomination = idea.projectAttachments?.find((attachment) => attachment.type === 'nomination')
            const team = idea.teamId ? teamsById.get(idea.teamId) : undefined
            const members = team ? membersByTeam.get(team.id) ?? [] : []
            const teamMembers = await Promise.all(members.map(async (member) => {
              const profile = await getProfile(member.userId)
              return {
                id: member.userId,
                name: profile?.name ?? member.userId,
                avatar: profile?.avatarUrl ?? undefined,
                role: member.role,
              }
            }))
            const screenshots = (idea.projectAttachments ?? [])
              .filter((attachment) => attachment.type === 'screenshot')
            const images = screenshots.map((attachment) => attachment.url)
            imageUpdates.push(Promise.all(screenshots.map((attachment) =>
              attachment.storageKey ? getImageUrl(attachment.storageKey).catch(() => attachment.url) : attachment.url,
            )).then((resolved) => ({ id: idea.id, images: [...resolved, ...(idea.attachments ?? [])].filter(Boolean) })))

            const creatorProfile = teamMembers.length > 0 || nomination?.name != null
              ? null
              : await getProfile(idea.createdBy)

            return {
              id: idea.id,
              nomination_type: idea.teamId || nomination?.nominationType === 'team' ? 'team' : 'individual',
              documents: idea.projectAttachments?.filter((item) => item.type === 'document') ?? [],
              title: idea.title,
              description: idea.description,
              nominee_org_code: nomination?.nomineeOrgCode ?? '',
              nominee_name: nomination?.name ?? teamMembers[0]?.name ?? creatorProfile?.name ?? team?.name ?? 'Individual Nominee',
              team_members: teamMembers,
              hackathon_id: hackathon.id,
              category: normalizeDigitalPioneerTrack(idea.category, idea.tags ?? []),
              technologies: parseNominationTags((idea.tags ?? []).join(',')),
              github_url: idea.repositoryUrl ?? undefined,
              demo_url: idea.demoUrl ?? undefined,
              images: screenshots.some((attachment) => attachment.storageKey)
                ? [] : [...images, ...(idea.attachments ?? [])].filter(Boolean),
              votes: idea.votes ?? 0,
              user_vote: idea.userHasVoted ?? false,
              status: idea.status,
              created_at: idea.createdAt,
              submission_date: idea.updatedAt,
            }
          }))

          return { projectList }
        }))
        if (sequence !== loadSequence.current) return
        setProjects(hackathonData.flatMap(({ projectList }) => projectList))
        // Photo URL requests must not hold the nomination list or voting controls open.
        imageUpdates.forEach((request) => {
          void request.then(({ id, images }) => {
            if (sequence !== loadSequence.current) return
            setProjects((current) => current.map((project) => project.id === id ? { ...project, images } : project))
            setSelectedProject((current) => current?.id === id ? { ...current, images } : current)
          })
        })
      } catch (error) {
        if (sequence !== loadSequence.current) return
        setLoadError(true)
        console.error('Error loading projects:', error)
        notifications.show({
          title: 'Unable to load nominations',
          message: 'Refresh the page to try again.',
          color: 'red',
        })
      } finally {
        if (sequence === loadSequence.current) setLoading(false)
      }
  }, [user])

  useEffect(() => {
    setRecordToDelete(null)
    setRecordError(null)
    setProjects([])
    setAssignedJudgeHackathons(new Set())
    setUploadForm(emptyUploadForm())
    setProjectImage(null)
    setIndividualDocument(null)
    setIndividualPreviewOpened(false)
    setSelectedProject(null)
    setModalOpened(false)
    setCartOpened(false)
    setVoteError(null)
    setSelectedIds(new Set())
    setPendingDeletion([])
    setDeleteError(null)
    setDeleteSuccess(null)
    void loadProjects()
    return () => { loadSequence.current += 1 }
  }, [loadProjects, user?.id])

  const nominationTags = parseNominationTags(uploadForm.technologies)
  const tooManyTags = nominationTags.length > 5
  const photoError = validatePersonalPhoto(projectImage)
  const documentError = validateNominationPdf(individualDocument)

  const handleProjectUpload = async (confirmed = false) => {
    if (!user || !canNominate || uploading || uploadBusy.current || (!editId && (ownNominations.isPending || ownNominations.isError || existingNomination))) return
    if (editId && editingNomination?.id !== editId) return
    if (!uploadForm.hackathonId || !uploadForm.executiveSummary.trim()
      || !uploadForm.achievementImpact.trim() || !uploadForm.cultureDemonstration.trim()
      || !uploadForm.category.trim() || (!projectImage && !editingNomination?.projectAttachments?.some((item) => item.type === 'screenshot'))) {
      notifications.show({
        title: 'Missing Information',
        message: 'Complete all required fields and select a nominee photo.',
        color: 'orange',
      })
      return
    }

    if (photoError || documentError) {
      notifications.show({ title: 'Invalid upload', message: photoError || documentError, color: 'orange' })
      return
    }

    if (tooManyTags) {
      notifications.show({ title: 'Too many tags', message: tagHint, color: 'orange' })
      return
    }

    // 第一次点击仅展示完整预览，二次确认后才沿用原有上传和审批提交流程。
    if (!confirmed) { setIndividualPreviewOpened(true); return }

    const nomineeUserId = user.id
    const nomineeName = user.name
    uploadBusy.current = true
    setUploading(true)
    try {
      const technologies = nominationTags
      const description = [
        `Executive Summary\n${uploadForm.executiveSummary.trim()}`,
        `Details of Your Core Achievement in 2026 and Business Impact (including financial figures)\n${uploadForm.achievementImpact.trim()}`,
        `How You Demonstrate Bosch China Culture (Especially in Your Applied Category)\n${uploadForm.cultureDemonstration.trim()}`,
      ].join('\n\n')
      const prefix = `nominations/${uploadForm.hackathonId}/${user.id}`
      const [uploadedImage, uploadedDocument] = await Promise.all([
        projectImage ? StorageService.uploadFile(projectImage, 'project-attachments', prefix) : null,
        individualDocument ? StorageService.uploadFile(individualDocument, 'project-attachments', prefix) : null,
      ])
      const payload: CreateIdeaInput = {
        title: nomineeName,
        description,
        hackathonId: uploadForm.hackathonId,
        category: uploadForm.category.trim(),
        tags: technologies,
        status: 'submitted',
        projectAttachments: [{ type: 'nomination', nominationType: 'individual', url: '', name: nomineeName, nomineeUserId },
          ...(uploadedImage && projectImage ? [{ type: 'screenshot' as const, url: uploadedImage.url, name: projectImage.name, storageKey: uploadedImage.key }]
            : editingNomination?.projectAttachments?.filter((item) => item.type === 'screenshot') ?? []),
          ...(uploadedDocument && individualDocument ? [{ type: 'document' as const, url: uploadedDocument.url, name: individualDocument.name, storageKey: uploadedDocument.key }]
            : editingNomination?.projectAttachments?.filter((item) => item.type !== 'nomination' && item.type !== 'screenshot') ?? []),
        ],
      }
      const submitted = editingNomination
        ? await IdeaService.updateIdea(editingNomination.id, { ...payload, approvalVersion: editingNomination.approvalVersion })
        : await IdeaService.createIdea(payload)
      setSubmittedNomination(submitted)
      setIndividualPreviewOpened(false)
      setSubmissionDraftWarning(null)
      if (individualDraftKey) {
        await NominationDraftStore.remove(individualDraftKey).catch(() => {
          setSubmissionDraftWarning('Your nomination was submitted, but its saved draft could not be removed. Discard that draft when you return to the nomination page.')
        })
        setIndividualDraft(null)
      }
      void ownNominations.refetch()
      setIndividualDocument(null)

      notifications.show({
        title: 'Nomination submitted',
        message: 'The nomination is now available for review.',
        color: 'green',
      })
      setProjectImage(null)
      setUploadForm(emptyUploadForm())
      await loadProjects()
    } catch (error) {
      notifications.show({
        title: 'Submission failed',
        message: error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Unable to submit the nomination',
        color: 'red',
      })
    } finally {
      uploadBusy.current = false
      setUploading(false)
    }
  }

  const refreshVoteState = async (ids: string[], sequence: number) => {
    const awardIds = [...new Set(projects.filter((project) => ids.includes(project.id)).map((project) => project.hackathon_id))]
    for (const awardId of awardIds) {
      void queryClient.invalidateQueries({ queryKey: ['score-summary', awardId] })
      void queryClient.invalidateQueries({ queryKey: ['judging-ideas', awardId], refetchType: 'none' })
    }
    try {
      const pages = await Promise.all(awardIds.map((awardId) => getAllPages((page) => IdeaService.getIdeas(awardId, page, 100))))
      if (sequence !== loadSequence.current) return
      const votes = new Map(pages.flat().map((idea) => [idea.id, { votes: idea.votes ?? 0, user_vote: idea.userHasVoted ?? false }]))
      setProjects((current) => current.map((project) => ({ ...project, ...votes.get(project.id) })))
      setSelectedProject((current) => current ? { ...current, ...votes.get(current.id) } : null)
    } catch {
      if (sequence === loadSequence.current) notifications.show({
        title: 'Votes saved', message: 'Unable to refresh the latest totals. Refresh the page to retry.', color: 'orange',
      })
    }
  }

  useEffect(() => {
    if (nominationMode || managementMode || loading || loadError) return
    let active = true
    let running = false
    const sequence = loadSequence.current
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || running || ballotBusy.current) return
      running = true
      try {
        const pages = await Promise.all(hackathons.map(async (award) => user
          ? (await getAllPages((page) => IdeaService.getIdeas(award.id, page, 100))).map((idea) => ({ id: idea.id, votes: idea.votes ?? 0, user_vote: idea.userHasVoted ?? false }))
          : (await getAllPages((page) => PublicAwardService.getNominations(award.id, page))).map((idea) => ({ id: idea.id, votes: idea.votes ?? 0, user_vote: false }))))
        if (!active || sequence !== loadSequence.current) return
        const counts = new Map(pages.flat().map((idea) => [idea.id, { votes: idea.votes, user_vote: idea.user_vote }]))
        setProjects((current) => current.map((project) => ({ ...project, ...counts.get(project.id) })))
        setSelectedProject((current) => current ? { ...current, ...counts.get(current.id) } : null)
      } catch { /* Existing totals remain visible; the next refresh can retry. */ }
      finally { running = false }
    }
    const timer = window.setInterval(() => void refresh(), 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [nominationMode, managementMode, loading, loadError, hackathons, user])

  useEffect(() => {
    if (nominationMode || managementMode || !isConnected) return
    const stops = hackathons.map((award) => subscribeToHackathonUpdates(award.id, (event) => {
      if (event.event !== 'VOTE_UPDATED' || typeof event.ideaId !== 'string' || typeof event.voteCount !== 'number' || event.voteCount < 0) return
      const count = event.voteCount
      setProjects((current) => current.map((item) => item.id === event.ideaId ? { ...item, votes: count } : item))
      setSelectedProject((current) => current && current.id === event.ideaId ? { ...current, votes: count } : current)
    }))
    return () => stops.forEach((stop) => stop?.())
  }, [hackathons, isConnected, subscribeToHackathonUpdates, nominationMode, managementMode])

  const handleVote = async (projectId: string) => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/projects?nominee=${projectId}`)}`)
      return
    }
    if (ballotBusy.current || loading || loadError) return
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    const removing = Boolean(project.user_vote)
    const sequence = loadSequence.current
    ballotBusy.current = true
    setSubmitting(true)
    setVoteError(null)
    try {
      if (removing) await IdeaService.deleteVoteRecord(projectId)
      else await IdeaService.submitVotes([projectId])
      if (sequence !== loadSequence.current) return
      setProjects((current) => current.map((item) => item.id === projectId
        ? { ...item, user_vote: !removing, votes: Math.max(0, item.votes + (removing ? -1 : 1)) } : item))
      setSelectedProject((current) => current?.id === projectId
        ? { ...current, user_vote: !removing, votes: Math.max(0, current.votes + (removing ? -1 : 1)) } : current)
      setCartOpened(true)
      await refreshVoteState([projectId], sequence)
    } catch (error) {
      if (sequence === loadSequence.current) setVoteError(error instanceof Error ? error.message : 'Unable to update your vote. Please try again.')
    } finally {
      ballotBusy.current = false
      setSubmitting(false)
    }
  }

  const deleteVotingRecord = async () => {
    if (!user || !recordToDelete || ballotBusy.current) return
    const sequence = loadSequence.current
    const id = recordToDelete.id
    ballotBusy.current = true
    setDeletingRecord(true)
    setRecordError(null)
    try {
      await IdeaService.deleteVoteRecord(id)
      if (sequence !== loadSequence.current) return
      setProjects((current) => current.map((project) => project.id === id
        ? { ...project, user_vote: false, votes: Math.max(0, project.votes - 1) } : project))
      setSelectedProject((project) => project?.id === id
        ? { ...project, user_vote: false, votes: Math.max(0, project.votes - 1) } : project)
      setRecordToDelete(null)
      await refreshVoteState([id], sequence)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      setRecordError(error instanceof Error ? error.message : 'Unable to delete your voting record. Please try again.')
    } finally {
      ballotBusy.current = false
      setDeletingRecord(false)
    }
  }

  useEffect(() => {
    if (!nomineeToOpen) { restoredNominee.current = null; return }
    if (loading || restoredNominee.current === nomineeToOpen) return
    const nomination = projects.find((project) => project.id === nomineeToOpen)
    if (nomination) {
      restoredNominee.current = nomineeToOpen
      setSelectedProject(nomination)
      setModalOpened(true)
    }
  }, [nomineeToOpen, loading, projects])

  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      const matchesSearch = project.title.toLowerCase().includes(filters.search.toLowerCase()) ||
                           project.description.toLowerCase().includes(filters.search.toLowerCase()) ||
                           project.nominee_name.toLowerCase().includes(filters.search.toLowerCase()) ||
                           project.nominee_org_code.toLowerCase().includes(filters.search.toLowerCase())
      
      const matchesCategory = !filters.category || project.category === filters.category
      const matchesDepartment = !filters.department || project.nominee_org_code.split('-')[0] === filters.department
      
      return (canDelete || project.nomination_type === votingType) && matchesSearch && matchesCategory && matchesDepartment
    })
  }, [projects, filters, canDelete, votingType])

  const submittedProjects = projects.filter((project) => project.user_vote)
  const currentTypeVoteCount = submittedProjects.filter((project) => project.nomination_type === votingType).length
  const locateVotedProject = (project: Project) => {
    setVotingType(project.nomination_type)
    setFilters({ search: '', category: '', department: '' })
    setLocateRequest({ id: project.id })
    // 小屏幕先收起浮层，避免遮挡定位后的卡片。
    if (window.matchMedia('(max-width: 767px)').matches) setCartOpened(false)
  }
  useEffect(() => {
    if (!locateRequest || loading) return
    const card = document.getElementById(`nominee-card-${locateRequest.id}`)
    if (!card) return
    card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' })
    card.focus({ preventScroll: true })
    setLocateRequest(null)
  }, [locateRequest, filteredProjects, loading])
  const typeProjects = canDelete ? projects : projects.filter((project) => project.nomination_type === votingType)
  const departments = useMemo(
    () => [...new Set(projects.map((project) => project.nominee_org_code.split('-')[0]).filter(Boolean))].sort(),
    [projects]
  )
  const nominationType = editingNomination
    ? editingNomination.projectAttachments?.find((item) => item.type === 'nomination')?.nominationType ?? 'individual'
    : preferredNominationType
  const existingNomination = ownNominations.data?.find((idea) => idea.hackathonId === uploadForm.hackathonId
    && (idea.teamId || idea.projectAttachments?.some((item) => item.type === 'nomination' && item.nominationType === 'team') ? 'team' : 'individual') === nominationType)
  const nominationTracks = getDigitalPioneerTracks(nominationType)
  const selectedNominationTrack = nominationTracks.find(
    (track) => track.value === uploadForm.category
  )

  const openProjectModal = (project: Project) => {
    setSelectedProject(project)
    setModalOpened(true)
    if (user?.role === 'participant' && !assignedJudgeHackathons.has(project.hackathon_id)) {
      void JudgingService.getJudges(project.hackathon_id).then((judges) => {
        if (judges.some((judge) => judge.userId === user.id)) {
          setAssignedJudgeHackathons((current) => new Set(current).add(project.hackathon_id))
        }
      }).catch(() => undefined)
    }
  }

  const requestDeletion = (targets: Project[]) => {
    if (!canDelete || deletingRef.current || !targets.length) return
    setDeleteError(null)
    setDeleteSuccess(null)
    setPendingDeletion(targets)
  }

  const confirmDeletion = async () => {
    if (!canDelete || deletingRef.current || !pendingDeletion.length) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError(null)
    const ids = pendingDeletion.map((project) => project.id)
    const sequence = loadSequence.current
    try {
      if (ids.length === 1) await IdeaService.deleteIdea(ids[0])
      else await IdeaService.deleteIdeas(ids)
      if (sequence !== loadSequence.current) return
      // Apply only committed deletions; all counts and the vote cart derive from this list.
      const deletedIds = new Set(ids)
      setProjects((current) => current.filter((project) => !deletedIds.has(project.id)))
      setSelectedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))))
      if (selectedProject && deletedIds.has(selectedProject.id)) {
        setSelectedProject(null)
        setModalOpened(false)
      }
      setPendingDeletion([])
      setDeleteSuccess(language === 'zh' ? `已删除 ${ids.length} 条提名。` : `Deleted ${ids.length} nomination(s).`)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      setDeleteError(error instanceof Error ? error.message : (language === 'zh' ? '删除失败，请重试。' : 'Unable to delete nominations. Please try again.'))
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  if (nominationMode) {
    if (submittedNomination) return <Container size={1240} py="xl" className="dp-page"><Card className="dp-form-shell" p="xl"><Stack gap="lg">
      <Title order={2}>Nomination Submitted Successfully</Title>
      <Title order={3}>{DIGITAL_PIONEER_TRACKS.find((track) => track.value === submittedNomination.category)?.label ?? submittedNomination.category}</Title>
      <Text c="white">Name: {user?.email ?? submittedNomination.title}</Text>
      <Text>Your nomination has been submitted.</Text>
      {submissionDraftWarning && <Text c="white" role="status">{submissionDraftWarning}</Text>}
      <NominationProgress idea={submittedNomination} />
      {submittedNomination.approvalStatus && <Text>Your Nominating HoD will review the information you submitted. Check My nominations for the decision and any requested changes.</Text>}
      <Group><Button variant="light" onClick={() => navigate('/')}>Home</Button><Button onClick={() => navigate(`/my-nominations?id=${encodeURIComponent(submittedNomination.id)}`)}>My nominations</Button></Group>
    </Stack></Card></Container>
    return (
      <Container size={1240} py={{ base: 'md', md: 'xl' }} className="dp-page dp-nomination-page">
        {photoToCrop && <PersonalPhotoCrop file={photoToCrop} language={language}
          onClose={() => setPhotoToCrop(null)}
          onConfirm={(file) => { setProjectImage(file); setPhotoToCrop(null) }} />}
        <Modal opened={individualPreviewOpened} className="dp-nomination-review" onClose={() => { if (!uploading) setIndividualPreviewOpened(false) }}
          title="Review Individual Nomination" size="lg" centered closeOnClickOutside={!uploading} closeOnEscape={!uploading}
          withCloseButton={!uploading} styles={{ content: { background: '#071b3b', color: 'white' }, header: { background: '#071b3b', color: 'white' }, title: { color: 'white' }, close: { color: 'white' } }}>
          <Stack gap="lg" c="white" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Title order={3}>{selectedNominationTrack?.label}</Title>
            <Text c="white"><strong>Name:</strong> {user?.email}</Text>
            <Text c="white"><strong>Nomination Type:</strong> Individual</Text>
            {photoPreview ? <Image src={photoPreview} alt="Nomination Review Photo" fit="contain" w="100%" h={280} />
              : editingNomination?.projectAttachments?.filter((item) => item.type === 'screenshot').map((item) => <RetainedNominationPhoto key={item.storageKey ?? item.url} attachment={item} />)}
            {[
              { heading: nominationHeadings[0], body: uploadForm.executiveSummary },
              { heading: nominationHeadings[1], body: uploadForm.achievementImpact },
              { heading: nominationHeadings[2], body: uploadForm.cultureDemonstration },
            ].map((section) => <section key={section.heading}>
              <Title order={4} c="white">{section.heading}</Title>
              <Text c="white" mt="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{section.body}</Text>
            </section>)}
            {nominationTags.length > 0 && <div><Title order={4} c="white">Tags</Title><Text c="white">{nominationTags.join(', ')}</Text></div>}
            {individualDocument ? <LocalNominationAttachment file={individualDocument} />
              : editingNomination?.projectAttachments?.filter((item) => item.type === 'document').map((item) => <NominationEvidence key={item.storageKey ?? item.url} attachment={item} />)}
            <Text c="white">Please confirm the information above. Your nomination will then be sent to your assigned HoD for review.</Text>
            <Group justify="flex-end">
              <Button variant="light" c="white" disabled={uploading} onClick={() => setIndividualPreviewOpened(false)}>Back To Edit</Button>
              <Button loading={uploading} disabled={!canNominate} onClick={() => void handleProjectUpload(true)}>Confirm And Submit</Button>
            </Group>
          </Stack>
        </Modal>
        <section className="dp-nomination-flow" aria-labelledby="track-choice-title">
          {eligibility.isError && <Alert color="red">Unable to verify your nomination eligibility. Please refresh.</Alert>}
          {eligibility.data && !canNominate && <Alert color="orange">{eligibility.data.message || 'Your signed-in account could not be matched to an eligible employee and Nominating HoD.'}</Alert>}
          {editError && <Alert color="red">{editError}</Alert>}
          {editId && !editingNomination && !editError && <Text>Loading your submitted nomination…</Text>}
          {editingNomination?.approvalReason && <Alert color="orange" title="Requested Changes">{editingNomination.approvalReason}</Alert>}
          <div className="dp-flow-heading">
            <div>
              <Title id="track-choice-title" order={2}>Start You Nomation</Title>
            </div>
            <Button.Group className="dp-type-switch" aria-label="Nomination type">
              {(['individual', 'team'] as const).map((type) => <Button key={type} radius="xl"
                variant={nominationType === type ? 'filled' : 'outline'} aria-pressed={nominationType === type}
                disabled={Boolean(editId) || uploading} onClick={() => setNominationType(type)}>
                {type === 'individual' ? 'Individual' : 'Team'}
              </Button>)}
            </Button.Group>
          </div>

          {individualDraftActive && user && <Stack gap="sm" mb="lg">
            {individualDraft && <Alert title="Saved Individual Draft" styles={{ title: { color: 'white' }, message: { color: 'white' } }}>
              A saved draft is available from {new Date(individualDraft.savedAt).toLocaleString()}.
              <Group mt="sm">
                <Button variant="light" c="white" disabled={uploading || savingDraft || Boolean(editId && !editingNomination)} onClick={restoreIndividualDraft}>Restore Draft</Button>
                <Button variant="light" c="white" disabled={uploading || savingDraft} onClick={() => void discardIndividualDraft()}>Discard Draft</Button>
              </Group>
            </Alert>}
            {draftNotice && <Text c="white" role="status">{draftNotice}</Text>}
          </Stack>}
          {teamDraftCategory && <Alert title="Saved Team Draft" mb="lg" styles={{ title: { color: 'white' }, message: { color: 'white' } }}>
            A team draft is available. Open its category, then choose Restore Draft to continue.
            <Button mt="sm" variant="light" c="white" onClick={() => setUploadForm((current) => ({ ...current, category: teamDraftCategory }))}>Open Saved Team Draft</Button>
          </Alert>}

          <div className="dp-nomination-tracks" role="radiogroup" aria-label="Nomination track">
            {nominationTracks.map((track) => {
              const isSelected = track.value === uploadForm.category
              return (
                <UnstyledButton
                  key={track.value}
                  className="dp-track dp-nomination-track"
                  data-active={isSelected}
                  role="radio"
                  aria-checked={isSelected}
                  aria-controls="nomination-track-description nomination-form"
                  aria-expanded={isSelected}
                  disabled={Boolean(editingNomination) && track.value !== editingNomination?.category}
                  onClick={() => setUploadForm((current) => ({ ...current, category: track.value }))}
                >
                  <span className="dp-nomination-track__topline">
                    <span aria-hidden="true" />
                    <span className="dp-nomination-track__check" aria-hidden="true">
                      {isSelected ? <IconCheck size={15} stroke={2.4} /> : null}
                    </span>
                  </span>
                  <span className="dp-nomination-track__name">{track.label}</span>
                  <span className="dp-nomination-track__description" lang="zh">{track.labelZh}</span>
                </UnstyledButton>
              )
            })}
          </div>

          {selectedNominationTrack && (
            <div id="nomination-track-description" className="dp-fieldset" translate="no" aria-live="polite">
              <Title order={3}>{selectedNominationTrack.label}</Title>
              <Text mt="sm" lang="zh">{selectedNominationTrack.labelZh}</Text>
              <AwardCriteriaList standards={selectedNominationTrack.standards} />
            </div>
          )}

          {!selectedNominationTrack ? (
            <div className="dp-track-gate" role="status">
              <Text fw={650}>Choose a track to begin</Text>
            </div>
          ) : loading ? (
            <div className="dp-track-gate" role="status">
              <Text fw={650}>Preparing the nomination form…</Text>
            </div>
          ) : loadError ? (
            <Alert color="red" icon={<IconInfoCircle size={18} />} mt="lg" styles={{ message: { color: 'white' } }}>
              Unable to load nominations. Refresh the page to try again.
            </Alert>
          ) : hackathons.length === 0 ? (
            <Alert color="orange" icon={<IconInfoCircle size={18} />} mt="lg" styles={{ message: { color: 'white' } }}>
              No nomination window is currently open.
            </Alert>
          ) : user && ownNominations.isPending ? <Text role="status">Checking your existing nominations…</Text>
            : user && ownNominations.isError ? <Alert color="red">Unable to verify your existing nominations. <Button variant="subtle" onClick={() => void ownNominations.refetch()}>Retry</Button></Alert>
            : !editId && existingNomination ? <Alert color="grape" className="dp-existing-nomination" title="Nomination Already Submitted">
              You can submit one Individual nomination and one Team nomination per award, across all categories.
              <Button variant="subtle" onClick={() => navigate(`/my-nominations?id=${encodeURIComponent(existingNomination.id)}`)}>View your nomination</Button>
            </Alert>
            : editId && !editingNomination ? null : nominationType === 'team' && user ? (
            <TeamNominationForm key={`${user.id}:${uploadForm.hackathonId}:${editingNomination?.id ?? 'new'}`}
              user={user} hackathonId={uploadForm.hackathonId} category={uploadForm.category}
              onCategoryChange={(category) => setUploadForm((current) => ({ ...current, category }))}
              canSubmit={canNominate} editing={editingNomination} onSubmitted={(idea, draftWarning) => { setSubmissionDraftWarning(draftWarning ?? null); setSubmittedNomination(idea); void ownNominations.refetch() }} />
          ) : (
            <Card className="dp-form-shell" p={{ base: 'lg', md: 38 }}>
              <Stack gap={0} id="nomination-form">
                  <div className="dp-fieldset" translate="no" style={{ borderTop: 0, paddingTop: 0 }}>
                    <Grid gutter="md">
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <div className="dp-form-intro">
                          <Title order={3}>{selectedNominationTrack.label}</Title>
                        </div>
                        <TextInput
                          label="Outlook Name"
                          value={user?.email ?? ''}
                          readOnly
                          required
                        />
                        <Input.Label id="personal-photo-label" htmlFor="personal-photo" required mt="xs">
                          <strong>Personal Photo</strong><span style={{ fontWeight: 400 }}>(JG, PNG or WebP; up to 50 MB per photo)</span>
                        </Input.Label>
                        {editingNomination?.projectAttachments?.some((item) => item.type === 'screenshot') && <Text size="sm">Your submitted photo is retained unless you upload a replacement.</Text>}
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }} pr={{ base: 'md', sm: 80 }} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
                        <FileInput
                          id="personal-photo"
                          aria-labelledby="personal-photo-label"
                          w={150}
                          styles={{
                            input: { height: 192, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
                            section: { top: 4, bottom: 'auto', height: 28 },
                          }}
                          placeholder={
                            <Stack gap={8} align="center" px="xs" style={{ whiteSpace: 'normal', textAlign: 'center', color: '#fff' }}>
                              <IconPhoto size={28} />
                              <Text size="xs">温馨提示：可以上传个人照片</Text>
                              <Text size="xs">建议比例 3:4，上传后可裁剪</Text>
                            </Stack>
                          }
                          valueComponent={() => photoPreview ? (
                            <Image src={photoPreview} alt={language === 'zh' ? '个人照片预览' : 'Personal photo preview'}
                              w="100%" h={190} fit="contain" radius="sm" />
                          ) : <Text size="sm" p="xs" lineClamp={3}>{projectImage?.name}</Text>}
                          required
                          accept={PHOTO_ACCEPT}
                          error={photoError ? (language === 'zh' ? (projectImage?.size === 0 ? '照片为空，请重新选择。' : projectImage && projectImage.size > MAX_UPLOAD_BYTES ? '照片超过 50 MB，请选择较小的图片。' : '请选择 JPG、PNG 或 WebP 格式的照片。') : photoError) : null}
                          value={projectImage}
                          onChange={(file) => {
                            if (!file || validatePersonalPhoto(file)) setProjectImage(file)
                            else {
                              setProjectImage((current) => validatePersonalPhoto(current) ? null : current)
                              setPhotoToCrop(file)
                            }
                          }}
                          clearable
                        />
                      </Grid.Col>
                      <Grid.Col span={12}>
                        <Select
                          label="Award Category"
                          renderOption={({ option }) => <span translate="no">{option.label}</span>}
                          data={nominationTracks.map((track) => ({ value: track.value, label: track.label }))}
                          value={uploadForm.category}
                          allowDeselect={false}
                          disabled={Boolean(editingNomination)}
                          onChange={(value) => {
                            if (value) setUploadForm((current) => ({ ...current, category: value }))
                          }}
                        />
                      </Grid.Col>
                    </Grid>
                  </div>

                  <div className="dp-fieldset" translate="no">
                    <div className="dp-nomination-question">
                      <div style={{ minWidth: 0 }}>
                        <Textarea
                          label={<><span className="dp-question-number" aria-hidden="true">01</span><span>Executive Summary (The Elevator Pitch)</span></>}
                          required
                          minRows={4}
                          maxLength={1200}
                          placeholder="中英文输入都可"
                          classNames={{ input: 'dp-bilingual-input' }}
                          value={uploadForm.executiveSummary}
                          onChange={(event) => setUploadForm((current) => ({ ...current, executiveSummary: event.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="dp-fieldset" translate="no">
                    <div className="dp-nomination-question">
                      <div style={{ minWidth: 0 }}>
                        <Textarea
                          label={<><span className="dp-question-number" aria-hidden="true">02</span><span>{nominationHeadings[1]}</span></>}
                          required
                          minRows={4}
                          maxLength={2400}
                          placeholder="中英文输入都可"
                          classNames={{ input: 'dp-bilingual-input' }}
                          value={uploadForm.achievementImpact}
                          onChange={(event) => setUploadForm((current) => ({ ...current, achievementImpact: event.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="dp-fieldset" translate="no">
                    <div className="dp-nomination-question">
                      <div style={{ minWidth: 0 }}>
                        <Textarea
                          label={<><span className="dp-question-number" aria-hidden="true">03</span><span>{nominationHeadings[2]}</span></>}
                          required
                          minRows={4}
                          maxLength={2000}
                          placeholder="中英文输入都可"
                          classNames={{ input: 'dp-bilingual-input' }}
                          value={uploadForm.cultureDemonstration}
                          onChange={(event) => setUploadForm((current) => ({ ...current, cultureDemonstration: event.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="dp-fieldset" translate="no">
                    <div className="dp-nomination-question">
                      <div style={{ minWidth: 0 }}>
                        <TextInput
                          label={<><span className="dp-question-number" aria-hidden="true">04</span><span>Tags You Want To Add (Add Up To 5 Tags: 、 , ，)</span></>}
                          styles={{ label: { whiteSpace: 'nowrap' } }}
                          error={tooManyTags ? tagHint : undefined}
                          placeholder="中英文输入都可"
                          classNames={{ input: 'dp-bilingual-input' }}
                          value={uploadForm.technologies}
                          onChange={(event) => setUploadForm((current) => ({ ...current, technologies: event.target.value }))}
                        />
                        <Text size="xs" c={tooManyTags ? 'red' : 'dimmed'} mt={6} aria-live="polite">{nominationTags.length} / 5</Text>
                        <Group gap={6} mt="xs" className="dp-nomination-tags">
                          {nominationTags.map((tag) => <Badge key={tag} size="sm" variant="light" title={tag}>{tag}</Badge>)}
                        </Group>
                      </div>
                    </div>
                  </div>

                  <div className="dp-fieldset" translate="no">
                    <FileInput label="Attachment" description="Optional PDF; up to 10 MB. Open the preview when needed." accept="application/pdf,.pdf"
                      clearable value={individualDocument} error={documentError} disabled={uploading} onChange={setIndividualDocument} />
                    {individualDocument && !documentError && <LocalNominationAttachment file={individualDocument} />}
                    {!individualDocument && editingNomination?.projectAttachments?.filter((item) => item.type === 'document').map((item) => <NominationEvidence key={item.storageKey ?? item.url} attachment={item} />)}
                  </div>
                  <Group justify="flex-end" align="center" pt="lg">
                    <Button variant="light" c="white" loading={savingDraft} disabled={uploading || !individualDraftKey}
                      onClick={() => void saveIndividualDraft()}>Save Draft</Button>
                    <Button
                      className="dp-primary-button"
                      rightSection={<IconArrowRight size={17} />}
                      onClick={() => void handleProjectUpload()}
                      loading={uploading}
                      disabled={!canNominate || tooManyTags || Boolean(photoError || documentError) || Boolean(editId && editingNomination?.id !== editId)}
                    >
                      {editingNomination ? 'Resubmit nomination' : 'Submit nomination'}
                    </Button>
                  </Group>
                </Stack>
            </Card>
          )}
        </section>
      </Container>
    )
  }

  return (
    <Container size={1240} pt={{ base: 'sm', md: 'lg' }} className={`dp-page dp-voting-page${cartOpened ? ' dp-voting-page--cart-open' : ''}`}>
      <Stack gap="lg">
        {loadError && <Alert color="red" title="Unable To Load Nominations"><Button variant="subtle" onClick={() => void loadProjects()}>Retry</Button></Alert>}
        <div className="dp-selection-header">
          <div className="dp-category-heading">
            <div>
              <h1 className="dp-section-title dp-selection-title">{canDelete ? (language === 'zh' ? '提名管理' : 'Manage Nominees') : <>Meet This Year&apos;s Nominees</>}</h1>
            </div>
            {!canDelete && <Button.Group className="dp-type-switch" aria-label="Voting nomination type">{(['team', 'individual'] as const).map((type) => <Button key={type} radius="xl" variant={votingType === type ? 'filled' : 'outline'} aria-pressed={votingType === type}
              onClick={() => { setVotingType(type); setFilters((current) => ({ ...current, department: '' })) }}>{type === 'team' ? 'Team' : 'Individual'}</Button>)}</Button.Group>}
          </div>
        </div>

        {!canDelete && <section className="dp-voting-rules" aria-label="Voting rules" translate="no">
          <Text fw={700}>{votingType === 'team' ? 'Team Awards — Voting Rules' : 'Individual Awards — Voting Rules'}</Text>
          <ol style={{ paddingLeft: 22 }}>
            <li>Click &quot;Vote&quot; to submit; click &quot;Submitted&quot; again to withdraw your vote.</li>
            {votingType === 'team' ? <li>You may vote for up to 3 nominees per category.</li>
              : <li>You may vote for up to 2 nominees within your department and up to 2 nominees in other departments per category. These two quotas are counted separately.</li>}
          </ol>
        </section>}

        <div className="dp-category-tabs" role="group" aria-label="Filter by award category">
          <UnstyledButton
            className="dp-category-tab"
            data-active={filters.category === ''}
            aria-pressed={filters.category === ''}
            onClick={() => setFilters((current) => ({ ...current, category: '' }))}
          >
            <span>All nominees</span>
            <span className="dp-category-tab__count">{typeProjects.length}</span>
          </UnstyledButton>
          {DIGITAL_PIONEER_TRACKS.map((track) => (
            <UnstyledButton
              key={track.value}
              className="dp-category-tab"
              data-active={filters.category === track.value}
              aria-pressed={filters.category === track.value}
              onClick={() => setFilters((current) => ({ ...current, category: track.value }))}
            >
              <span>{track.label}</span>
              <span className="dp-category-tab__count">
                {typeProjects.filter((project) => project.category === track.value).length}
              </span>
            </UnstyledButton>
          ))}
        </div>

        {!nominationMode && (
        <>
        <Card className="dp-filter-shell" p="sm">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <TextInput
                placeholder="Search nominees"
                leftSection={<IconSearch size={16} />}
                value={filters.search}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
              />
              <Select
                placeholder="Filter by department"
                aria-label="Filter by department"
                data={departments}
                value={filters.department || null}
                onChange={(value) => setFilters(prev => ({ ...prev, department: value || '' }))}
                searchable
                clearable
              />
          </SimpleGrid>
        </Card>

        {canDelete && <Stack gap="sm">
          <Group justify="space-between">
            <Checkbox
              label={language === 'zh' ? `全选当前结果（${filteredProjects.length}）` : `Select all results (${filteredProjects.length})`}
              styles={{ label: { color: '#d9e1ec' } }}
              checked={filteredProjects.length > 0 && filteredProjects.every((project) => selectedIds.has(project.id))}
              indeterminate={filteredProjects.some((project) => selectedIds.has(project.id)) && !filteredProjects.every((project) => selectedIds.has(project.id))}
              disabled={loading || loadError || deleting || !filteredProjects.length}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setSelectedIds((current) => {
                  const next = new Set(current)
                  filteredProjects.forEach((project) => { if (checked) next.add(project.id); else next.delete(project.id) })
                  return next
                })
              }}
            />
            <Group gap="sm">
              <Button color="red" variant="outline" disabled={loading || loadError || deleting || !selectedIds.size}
                onClick={() => requestDeletion(projects.filter((project) => selectedIds.has(project.id)))}>
                {language === 'zh' ? `删除选中（${selectedIds.size}）` : `Delete selected (${selectedIds.size})`}
              </Button>
              <Button color="red" leftSection={<IconTrash size={16} />} disabled={loading || loadError || deleting || !projects.length}
                onClick={() => requestDeletion(projects)}>
                {language === 'zh' ? `一键删除全部（${projects.length}）` : `Delete all (${projects.length})`}
              </Button>
            </Group>
          </Group>
          {deleteSuccess && <Text c="#d9e1ec" role="status">{deleteSuccess}</Text>}
        </Stack>}

        <SimpleGrid className="dp-project-grid" cols={{ base: 1, sm: 2 }} spacing="md">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="dp-project-card" h={330} p="lg">
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text c="dimmed">Loading nominations…</Text>
                </div>
              </Card>
            ))
          ) : filteredProjects.length > 0 ? (
            filteredProjects.map((project) => (
              <Card
                key={project.id}
                id={`nominee-card-${project.id}`}
                tabIndex={-1}
                className="dp-project-card"
                data-voted={project.user_vote ? 'true' : undefined}
                p={0}
              >
                <div className="dp-candidate-layout">
                  <div className="dp-card-visual">
                    {project.images[0] ? (
                      <NomineePhoto key={project.images[0]} src={project.images[0]} name={project.nominee_name} />
                    ) : (
                      <div className="dp-nominee-placeholder">
                        <IconUser size={24} />
                        <Text c="dimmed" size="sm">Nominee photo</Text>
                      </div>
                    )}
                    {project.user_vote ? (
                      <div className="dp-vote-stamp" role="status">
                        <IconThumbUpFilled size={14} />
                        <span>Voted</span>
                      </div>
                    ) : null}
                    <Button className="dp-candidate-details-link" size="compact-sm" variant="subtle" onClick={() => openProjectModal(project)}>
                      View details
                    </Button>
                  </div>

                  <div className="dp-candidate-info">
                  <div className="dp-candidate-scroll" tabIndex={0} role="region" aria-label={language === 'zh' ? `${project.nominee_name} 的报名信息` : `Nomination information for ${project.nominee_name}`}>
                  {canDelete && <Checkbox mb="sm" checked={selectedIds.has(project.id)} disabled={deleting}
                    styles={{ label: { color: 'inherit' } }}
                    label={language === 'zh' ? `选择 ${project.title}` : `Select ${project.title}`}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setSelectedIds((current) => {
                        const next = new Set(current)
                        if (checked) next.add(project.id); else next.delete(project.id)
                        return next
                      })
                    }} />}
                  <Title order={3} translate="no">{project.title}</Title>
                  <Text className="dp-candidate-summary-title" fw={700} mt="md">Summary</Text>
                  <Text size="sm" className="dp-candidate-description" tabIndex={0} role="region" aria-label={`${project.nominee_name} Summary`}>{nominationSummary(project.description)}</Text>

                  <Group gap={6} className="dp-nomination-tags" translate="no">
                    {project.technologies.map((tech) => (
                      <Badge key={tech} size="sm" variant="light" title={tech}>
                        {tech}
                      </Badge>
                    ))}
                  </Group>

                  </div>
                  <Group className="dp-candidate-actions" justify="space-between" align="center" wrap="wrap">
                    <Group gap={6}>
                      {project.github_url && (
                        <ActionIcon
                          component="a"
                          href={project.github_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="light"
                          size="sm"
                          aria-label="Open evidence"
                        >
                          <IconBrandGithub size={14} />
                        </ActionIcon>
                      )}
                      {project.demo_url && (
                        <ActionIcon
                          component="a"
                          href={project.demo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="light"
                          size="sm"
                          aria-label="Open additional evidence"
                        >
                          <IconWorldWww size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                    {canDelete ? <Button color="red" leftSection={<IconTrash size={16} />} disabled={deleting || loading || loadError}
                      aria-label={language === 'zh' ? `删除 ${project.title}` : `Delete ${project.title}`}
                      onClick={() => requestDeletion([project])}>
                      {language === 'zh' ? '删除' : 'Delete'}
                    </Button> : <Button
                      className="dp-vote-button"
                      disabled={submitting || deletingRecord}
                      data-voted={project.user_vote ? 'true' : 'false'}
                      variant={project.user_vote ? 'filled' : 'default'}
                      leftSection={project.user_vote ? <IconThumbUpFilled size={16} /> : <IconThumbUp size={16} />}
                      aria-label={project.user_vote ? `Submitted, ${project.votes} votes` : `Vote, ${project.votes} votes`}
                      aria-pressed={Boolean(project.user_vote)}
                      title={project.user_vote ? 'Click to cancel your vote' : 'Click to submit your vote'}
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleVote(project.id)
                      }}
                    >
                      {project.user_vote ? 'Submitted' : 'Vote'} ({project.votes})
                    </Button>}
                  </Group>
                  </div>
                </div>
              </Card>
            ))
          ) : (
            <div style={{ gridColumn: '1 / -1' }}>
              <Center py="xl">
                <Stack align="center">
                  <ThemeIcon size={60} variant="light" color="gray">
                    <IconTrophy size={30} />
                  </ThemeIcon>
                  <Text c="dimmed">No nominations match these filters.</Text>
                  <Button leftSection={<IconUpload size={16} />} onClick={() => navigate('/nominate')}>
                    New nomination
                  </Button>
                </Stack>
              </Center>
            </div>
          )}
        </SimpleGrid>
        </>
        )}

        {!canDelete && <Button
          className="dp-vote-cart-button"
          leftSection={<IconThumbUp size={22} />}
          rightSection={<Badge className="dp-vote-cart-count" variant="filled">{currentTypeVoteCount}</Badge>}
          aria-label={language === 'zh' ? `我的点赞（${currentTypeVoteCount}）` : `My votes (${currentTypeVoteCount})`}
          aria-controls="vote-cart"
          aria-haspopup="dialog"
          aria-expanded={cartOpened}
          onClick={() => setCartOpened((opened) => !opened)}
        >
          {language === 'zh' ? '我的点赞' : 'My votes'}
        </Button>}

        {cartOpened && <section id="vote-cart" className="dp-vote-cart-panel" role="dialog" aria-modal="false"
          aria-labelledby="vote-cart-title" onKeyDown={(event) => { if (event.key === 'Escape') closeVoteCart() }}>
          <Group className="dp-vote-cart-header" justify="space-between" wrap="nowrap">
            <Title order={2} size="h4" id="vote-cart-title" aria-live="polite">My Votes ({submittedProjects.length})</Title>
            <CloseButton aria-label="Close my votes" onClick={closeVoteCart} />
          </Group>
          <div className="dp-vote-cart-body"><Stack gap="md">
            <Text size="sm">Each successful click is saved immediately. All your submitted Individual and Team votes appear here.</Text>
            {!user ? <Text>Sign in to view your votes.</Text>
              : loading ? <Text role="status">Loading voting records…</Text>
              : loadError ? <Alert color="red">Unable to load voting records.</Alert>
              : submittedProjects.length === 0 ? <Text>No submitted votes yet.</Text>
              : submittedProjects.map((project) => <div className="dp-vote-cart-item" key={project.id} onClick={() => locateVotedProject(project)}>
                <UnstyledButton className="dp-vote-cart-locate" aria-label={`Locate ${project.title}`} onClick={(event) => { event.stopPropagation(); locateVotedProject(project) }}>
                <Group wrap="nowrap" align="flex-start">
                  <Avatar src={project.images[0]} alt={project.nominee_name} size={56} radius="md"><IconUser /></Avatar>
                  <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={700} style={{ overflowWrap: 'anywhere' }} translate="no">{project.title}</Text>
                    <Text size="xs">{project.nomination_type === 'team' ? 'Team' : 'Individual'} · {project.category}</Text>
                  </Stack>
                </Group>
                </UnstyledButton>
                <Group justify="space-between" mt="sm">
                  <Button variant="subtle" size="xs" onClick={(event) => { event.stopPropagation(); openProjectModal(project) }}>View details</Button>
                  <Button variant="light" color="red" c="#ffb1b1" size="xs" leftSection={<IconTrash size={15} />}
                    disabled={submitting || deletingRecord} aria-label={`Delete voting record for ${project.title}`}
                    onClick={(event) => { event.stopPropagation(); setRecordError(null); setRecordToDelete(project) }}>Delete</Button>
                </Group>
              </div>)}
          </Stack></div>
        </section>}
        <Modal opened={Boolean(voteError)} onClose={() => setVoteError(null)} title="Vote Not Submitted" centered zIndex={400}>
          <Stack><Alert color="red" role="alert">{voteError}</Alert><Button onClick={() => setVoteError(null)}>OK</Button></Stack>
        </Modal>

        <Modal opened={recordsOpened} zIndex={310} onClose={closeVotingRecords} title="My Voting Records" size="lg" centered>
          <Stack>
            {!user ? <Text>Sign in to view your voting records.</Text>
              : loading ? <Text role="status">Loading voting records…</Text>
              : loadError ? <Alert color="red" title="Unable To Load Voting Records">
                <Button variant="subtle" onClick={() => void loadProjects()}>Retry</Button>
              </Alert>
              : <>
                <Text role="status">Your submitted votes are saved to the database. You can view them here anytime from your account menu.</Text>
                <Text size="sm" c="dimmed">To change a submitted vote, delete its record, then click Vote on your new selection.</Text>
                {submittedProjects.length === 0 ? <Text>No submitted votes yet.</Text> : submittedProjects.map((project) => (
                  <Card key={project.id} withBorder>
                    <Group justify="space-between" wrap="nowrap" mb="sm">
                      <Avatar src={project.images[0]} alt={project.nominee_name} size={48} radius="md"><IconUser /></Avatar>
                      <Button color="red" variant="light" size="xs" leftSection={<IconTrash size={14} />}
                        aria-label={`Delete voting record for ${project.title}`} disabled={deletingRecord || submitting}
                        onClick={() => { setRecordError(null); setRecordToDelete(project) }}>Delete</Button>
                    </Group>
                    <Stack gap={4} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                      <Text fw={700} translate="no">{project.title}</Text>
                      {project.nominee_name !== project.title && <Text size="sm" translate="no">{project.nominee_name}</Text>}
                      <Text size="sm">{hackathons.find((award) => award.id === project.hackathon_id)?.title}</Text>
                      <Text size="sm">{DIGITAL_PIONEER_TRACKS.find((track) => track.value === project.category)?.label ?? project.category}</Text>
                      <Text size="sm">Department: <span translate="no">{project.nominee_org_code || '—'}</span></Text>
                      <Button variant="subtle" size="xs" onClick={() => { closeVotingRecords(); openProjectModal(project) }}>View details</Button>
                    </Stack>
                  </Card>
                ))}
              </>}
            <Button variant="light" onClick={closeVotingRecords}>Back to nominees</Button>
          </Stack>
        </Modal>

        <Modal opened={recordToDelete !== null} onClose={() => { if (!deletingRecord) setRecordToDelete(null) }}
          title="Delete Voting Record?" centered zIndex={310} closeOnClickOutside={!deletingRecord}
          closeOnEscape={!deletingRecord} withCloseButton={!deletingRecord}>
          <Stack>
            <Text>Delete your submitted vote for <span translate="no">{recordToDelete?.title}</span>? This action cannot be undone.</Text>
            <Text size="sm" c="dimmed">You can select a nominee and submit a new vote after deleting this record.</Text>
            {recordError && <Alert color="red" role="alert">{recordError}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" disabled={deletingRecord} onClick={() => setRecordToDelete(null)}>Cancel</Button>
              <Button color="red" loading={deletingRecord} onClick={() => void deleteVotingRecord()}>Delete permanently</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={canDelete && pendingDeletion.length > 0}
          onClose={() => { if (!deleting) setPendingDeletion([]) }}
          title={language === 'zh' ? '确认删除提名' : 'Confirm Nomination Deletion'}
          centered
          closeOnClickOutside={false}
          closeOnEscape={!deleting}
          withCloseButton={!deleting}
          classNames={{ content: 'dp-candidate-modal', header: 'dp-candidate-modal-header' }}
        >
          <Stack>
            <Text>{language === 'zh'
              ? `即将永久删除 ${pendingDeletion.length} 条提名及其关联的投票、评论和评分，无法撤销。`
              : `Permanently delete ${pendingDeletion.length} nomination(s) and their votes, comments and scores? This cannot be undone.`}</Text>
            <Stack gap="xs" mah={200} style={{ overflowY: 'auto' }}>
              {pendingDeletion.map((project) => <Text key={project.id} size="sm" translate="no" style={{ overflowWrap: 'anywhere' }}>{project.title} · {project.category}</Text>)}
            </Stack>
            {deleteError && <Text c="red.3" role="alert">{deleteError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" disabled={deleting} onClick={() => setPendingDeletion([])}>{language === 'zh' ? '取消' : 'Cancel'}</Button>
              <Button color="red" loading={deleting} onClick={() => void confirmDeletion()}>{language === 'zh' ? '确认删除' : 'Confirm delete'}</Button>
            </Group>
          </Stack>
        </Modal>

        {/* Project Detail Modal */}
        <Modal
          opened={modalOpened}
          onClose={() => setModalOpened(false)}
          title={selectedProject?.title}
          size="min(1200px, calc(100vw - 32px))"
          centered
          classNames={{ content: 'dp-detail-modal', header: 'dp-detail-modal-header', body: 'dp-detail-modal-body' }}
        >
        {selectedProject && (
          <div className="dp-detail-layout">
            <Stack gap="md" className="dp-detail-sidebar">
              {selectedProject.images[0] ? (
                <Image
                  src={selectedProject.images[0]}
                  alt={`${selectedProject.nominee_name} nomination`}
                  className="dp-candidate-detail-photo"
                  decoding="async"
                  radius="md"
                  fit="contain"
                />
              ) : (
                <div className="dp-detail-photo-placeholder" style={{ backgroundColor: '#123457', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text c="dimmed">Nominee photo</Text>
                </div>
              )}

              <Badge variant="light" w="fit-content">{selectedProject.category}</Badge>

              {/* Individual nominee */}
              <div>
                <Title order={5} mb="sm">Nominee</Title>
                <Group>
                  {([{ id: selectedProject.id, name: selectedProject.nominee_name, role: undefined }]).map((member) => (
                    <Group key={member.id} gap="xs">
                      <Avatar size="sm" />
                      <div>
                        <Text size="sm" fw={500} translate="no">{member.name}</Text>
                        <Text size="sm" c="dimmed"><span>Org. Code</span>: <span translate="no">{selectedProject.nominee_org_code || '—'}</span></Text>
                        {member.role && <Text size="sm" c="dimmed">{member.role}</Text>}
                      </div>
                    </Group>
                  ))}
                </Group>
              </div>

              {selectedProject.nomination_type !== 'team' && <div>
                <Title order={5} mb="sm">Tags</Title>
                <Group>
                  {selectedProject.technologies.map((tech) => (
                    <Badge key={tech} variant="light">
                      {tech}
                    </Badge>
                  ))}
                </Group>
              </div>}

              {/* Links */}
              <Group>
                {selectedProject.github_url && (
                  <Button
                    component="a"
                    href={selectedProject.github_url}
                    target="_blank"
                    leftSection={<IconBrandGithub size={16} />}
                    variant="light"
                  >
                    View Evidence
                  </Button>
                )}
                {selectedProject.demo_url && (
                  <Button
                    component="a"
                    href={selectedProject.demo_url}
                    target="_blank"
                    leftSection={<IconExternalLink size={16} />}
                    variant="light"
                  >
                    Additional evidence
                  </Button>
                )}
                {(user?.role === 'admin' || user?.role === 'manager'
                  || assignedJudgeHackathons.has(selectedProject.hackathon_id)) && (
                  <Button
                    leftSection={<IconGavel size={16} />}
                    variant="light"
                    color="grape"
                    onClick={() => navigate(`/hackathons/${selectedProject.hackathon_id}/judge`)}
                  >
                    Committee scoring
                  </Button>
                )}
              </Group>

              {/* Vote Button */}
              <Button
                fullWidth
                disabled={submitting || deletingRecord || loading}
                leftSection={selectedProject.user_vote ? <IconThumbUpFilled size={16} /> : <IconThumbUp size={16} />}
                variant={selectedProject.user_vote ? 'filled' : 'light'}
                color="red"
                onClick={() => handleVote(selectedProject.id)}
              >
                {selectedProject.user_vote ? 'Cancel vote' : 'Vote'} ({selectedProject.votes})
              </Button>
            </Stack>
            {/* Description */}
            <div className="dp-candidate-detail-sections">
              {parseNominationDescription(selectedProject.description, selectedProject.nomination_type).map((section, index) => (
                <section className="dp-candidate-detail-section" key={index}>
                  {section.heading && <Title order={3} className="dp-candidate-detail-heading">{section.heading}</Title>}
                  {section.body.split(/\n\s*\n/).map((paragraph, paragraphIndex) => (
                    <Text className="dp-candidate-detail-paragraph" key={paragraphIndex}>{paragraph}</Text>
                  ))}
                </section>
              ))}
              {selectedProject.documents?.map((item) => <NominationEvidence key={item.storageKey ?? item.url} attachment={item} />)}
            </div>
          </div>
        )}
      </Modal>

      </Stack>
    </Container>
  )
}
