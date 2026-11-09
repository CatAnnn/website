import { useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Container,
  Grid,
  Group,
  Loader,
  Modal,
  Progress,
  Select,
  NumberInput,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconClipboardCheck,
  IconExternalLink,
  IconScale,
  IconTrophy,
} from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { DIGITAL_PIONEER_RECOMMENDATIONS, DIGITAL_PIONEER_TRACKS, normalizeDigitalPioneerTrack } from '../config/digitalPioneer'
import { useNominationEligibility } from '../hooks/useNominationEligibility'
import { useAuthStore } from '../store/authStore'
import { loadAllNominations, officialCriteria, savedEvaluation, criteriaForNomination } from '../utils/committeeScoring'
import type { JudgeScore } from '../services/judgingService'
import type { Idea, ProjectAttachment } from '../services/ideaService'
import { StorageService } from '../services/storageService'
import { JudgingService } from '../services/judgingService'
import { VotingService } from '../services/votingService'
import type { VotingCriteria } from '../services/votingService'
import { PermissionService } from '../utils/permissions'
import { useLanguage } from '../contexts/LanguageContext'
import { translateUiText } from '../contexts/uiTranslations'
import { NominationEvidence } from '../components/DigitalPioneer/NominationEvidence'
import './DigitalPioneer.css'

interface IdeaScores {
  [criteriaId: string]: number | string
}

interface ScoreSubmission {
  ideaId: string
  scores: IdeaScores
  recommendation: string
  comment: string
}

function getScoreTone(score: number): string {
  if (score >= 9) return 'grape'
  if (score >= 7) return 'green'
  if (score >= 5) return 'yellow'
  return 'red'
}

function isImageAttachment(attachment: ProjectAttachment): boolean {
  return attachment.type !== 'nomination' && (attachment.type === 'screenshot'
    || /\.(png|jpe?g|webp|gif|avif|bmp)(?:[?#]|$)/i.test(attachment.name || attachment.storageKey || attachment.url))
}

function JudgingImage({ attachment }: { attachment: ProjectAttachment }) {
  const [opened, setOpened] = useState(false)
  const [imageError, setImageError] = useState(false)
  const { data: url, isError, isFetching, refetch } = useQuery({
    queryKey: ['judging-image', attachment.storageKey, attachment.url],
    queryFn: async () => {
      if (attachment.storageKey) return StorageService.getPresignedUrl('project-attachments', attachment.storageKey)
      if (/^https?:\/\//i.test(attachment.url) || attachment.url.startsWith('/storage/')) return attachment.url
      throw new Error('Unable to load attachment.')
    },
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
  })
  const failed = isError || imageError

  return <>
    <UnstyledButton
      aria-label={failed ? 'Retry image' : `Preview ${attachment.name || 'image'}`}
      onClick={() => {
        if (failed) { setImageError(false); void refetch() }
        else if (url) setOpened(true)
      }}
      disabled={isFetching && !url}
      w={96} h={112}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', background: 'transparent', border: 0, borderRadius: 0 }}
    >
      {failed ? <Text size="xs" ta="center">Unable to load image. Retry</Text> : url ? (
        <img src={url} alt={attachment.name || 'Nomination image'} width={96} height={112}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setImageError(true)} />
      ) : <Loader size="sm" />}
    </UnstyledButton>
    <Modal opened={opened} onClose={() => setOpened(false)} centered size="auto" title={attachment.name || 'Image Preview'}
      closeButtonProps={{ 'aria-label': 'Close image preview' }} styles={{
        content: { maxWidth: 'calc(100vw - 32px)', background: 'transparent', boxShadow: 'none' },
        header: { background: 'transparent' },
      }}>
      {url && <img src={url} alt={attachment.name || 'Nomination image'}
        style={{ display: 'block', maxWidth: '100%', maxHeight: '75dvh', objectFit: 'contain', margin: '0 auto' }} />}
    </Modal>
  </>
}

interface IdeaJudgingCardProps {
  idea: Idea
  criteria: VotingCriteria[]
  onDelete: () => void
  onSubmit: (submission: ScoreSubmission) => void
  isSubmitting: boolean
  alreadyScored: boolean
  savedScores: JudgeScore[]
  canSubmitRating: boolean
}

function IdeaJudgingCard({
  idea,
  criteria,
  onSubmit,
  onDelete,
  isSubmitting,
  alreadyScored,
  savedScores,
  canSubmitRating,
}: IdeaJudgingCardProps): ReactElement {
  const { language } = useLanguage()
  const nominee = idea.projectAttachments?.find((attachment) => attachment.type === 'nomination')
  const images = (idea.projectAttachments ?? []).filter(isImageAttachment)
  const saved = savedEvaluation(savedScores)
  const [scores, setScores] = useState<IdeaScores>(() =>
    Object.fromEntries(criteria.map((criterion) => [criterion.id, saved.scores[criterion.id] ?? '']))
  )
  const [recommendation, setRecommendation] = useState<string | null>(saved.recommendation)
  const [comment, setComment] = useState(saved.comment)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const weightedScore = criteria.reduce(
    (total, criterion) => total + Number(scores[criterion.id] || 0) * (criterion.weight / 100),
    0
  )
  const canSubmit = canSubmitRating && criteria.length > 0
    && criteria.every((criterion) => Number.isInteger(scores[criterion.id]) && Number(scores[criterion.id]) >= 1 && Number(scores[criterion.id]) <= 10)
    && recommendation !== null

  return (
    <Card className="dp-judge-shell" p={{ base: 'lg', md: 32 }}>
      <Grid gutter={{ base: 24, md: 38 }}>
        <Grid.Col span={{ base: 12, lg: 4 }} style={{ display: 'flex', minWidth: 0 }}>
          <Box pos="relative" w="100%" mih={{ base: 540, lg: 0 }}>
            <Stack gap="md" pos="absolute" top={0} bottom={0} left={0} right={0}>
              <Group align="flex-start" wrap="nowrap" gap="sm" style={{ flexShrink: 0 }}>
                <Stack gap="md" style={{ flex: 1, minWidth: 0, maxHeight: images.length ? 112 : undefined, overflowY: 'auto', overflowWrap: 'anywhere' }}>
                  <Group gap="xs">
                    <Badge variant="light" color="grape">{idea.category}</Badge>
                    {alreadyScored ? (
                      <Badge color="teal" variant="light" leftSection={<IconCheck size={12} />}>Recorded</Badge>
                    ) : null}
                  </Group>
                  <Title order={3}>{idea.title}</Title>
                </Stack>
                {images.length > 0 && <Stack gap="xs" w={96} h={112} style={{ flexShrink: 0, overflowY: 'auto' }}>
                  {images.map((attachment) => <JudgingImage key={attachment.storageKey || attachment.url} attachment={attachment} />)}
                </Stack>}
              </Group>
              <Stack gap="md" tabIndex={0} aria-label="Nomination details"
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowWrap: 'anywhere', paddingRight: 8 }}>
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-line' }}>
                  {idea.description}
                </Text>
                <div className="dp-fieldset">
                  <Text size="sm"><b>Nominee:</b> {nominee?.name ?? 'Not provided'}</Text>
                  <Text size="sm"><b>Org. code:</b> {nominee?.nomineeOrgCode ?? 'Not provided'}</Text>
                  <Text size="sm"><b>Position:</b> {nominee?.nomineePosition ?? 'Not provided'}</Text>
                  <Text size="sm"><b>Nominating HoD:</b> {nominee?.nominatingHead ?? 'Not provided'}</Text>
                </div>
                <Group gap="xs">
                  {idea.tags.slice(0, 4).map((tag) => <Badge key={tag} size="sm" variant="outline">{tag}</Badge>)}
                </Group>
                <Stack gap="xs" mt="auto">
                  {(idea.projectAttachments ?? []).filter((attachment) => attachment.type !== 'nomination' && !isImageAttachment(attachment)).map((attachment) => (
                    <NominationEvidence key={attachment.storageKey || attachment.url} attachment={attachment} />
                  ))}
                  {idea.repositoryUrl ? (
                    <Button component="a" href={idea.repositoryUrl} target="_blank" variant="light" rightSection={<IconExternalLink size={15} />}>
                      Review evidence
                    </Button>
                  ) : null}
                  {idea.demoUrl ? (
                    <Button component="a" href={idea.demoUrl} target="_blank" variant="subtle" rightSection={<IconExternalLink size={15} />}>
                      Open demo
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </Stack>
          </Box>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="xl">
            <Group justify="space-between" align="flex-end">
              <div>
                <Title order={3}>Score The Evidence</Title>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Text className="dp-utility" size="sm" c="dimmed">Weighted total</Text>
                <Text className="dp-field-number" fw={700}>{criteria.every((criterion) => scores[criterion.id] !== '') ? weightedScore.toFixed(1) : '—'}</Text>
              </div>
            </Group>

            {criteria.map((criterion) => {
              const score = scores[criterion.id] ?? ''
              const numericScore = Number(score)
              return (
                <div className="dp-fieldset" key={criterion.id}>
                  <Group justify="space-between" align="flex-start" mb="lg">
                    <div>
                      <Group gap="xs">
                        <Text fw={800}>{criterion.name}</Text>
                        <Badge variant="filled" color="dark">{criterion.weight}%</Badge>
                      </Group>
                      <Text size="sm" c="dimmed" mt={5}>{criterion.description}</Text>
                    </div>
                    <Badge key={String(score)} color={getScoreTone(numericScore)} variant="light" size="lg">
                      {score === '' ? <span>Not scored</span> : <><span>{score} · </span><span>{'/ 10'}</span></>}
                    </Badge>
                  </Group>
                  <NumberInput
                    label={`${criterion.name} score`}
                    description="Enter a whole number from 1 to 10."
                    placeholder="Enter score"
                    required
                    value={score}
                    onChange={(value) => setScores((current) => ({ ...current, [criterion.id]: value }))}
                    min={1}
                    max={10}
                    allowDecimal={false}
                    allowNegative={false}
                    disabled={!canSubmitRating || isSubmitting}
                    size="md"
                    maw={320}
                  />

                </div>
              )
            })}

            <div className="dp-fieldset">
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, sm: 5 }}>
                  <Select
                    label="Recommendation"
                   
                    required
                    disabled={!canSubmitRating || isSubmitting}
                    placeholder="Select a recommendation"
                    data={DIGITAL_PIONEER_RECOMMENDATIONS.map(({ value, label }) => ({ value, label: language === 'zh' ? translateUiText(label) : label }))}
                    value={recommendation}
                    onChange={setRecommendation}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 7 }}>
                  <Textarea
                    label="Comments, if any"
                   
                    disabled={!canSubmitRating || isSubmitting}
                    minRows={3}
                    maxLength={1200}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </Grid.Col>
              </Grid>
            </div>

            {alreadyScored ? (
              <Alert color="teal" icon={<IconCheck size={18} />}>
                A rating from you is already recorded. Submit again only if you intend to update it.
              </Alert>
            ) : null}

            {savedScores.length > 0 && canSubmitRating && (
              <Group justify="flex-end">
                {confirmDelete ? <>
                  <Text size="sm">Remove your rating and comments?</Text>
                  <Button variant="subtle" disabled={isSubmitting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button color="red" loading={isSubmitting} onClick={onDelete}>Confirm deletion</Button>
                </> : <Button color="red" variant="subtle" disabled={isSubmitting} onClick={() => setConfirmDelete(true)}>Delete rating</Button>}
              </Group>
            )}
            <Group justify="space-between" align="center">
              <div style={{ flex: 1, maxWidth: 260 }}>
                <Progress value={weightedScore * 10} color={getScoreTone(weightedScore)} size="sm" />
              </div>
              <Button
                className="dp-primary-button"
                leftSection={<IconClipboardCheck size={17} />}
                disabled={!canSubmit}
                loading={isSubmitting}
                onClick={() => onSubmit({
                  ideaId: idea.id,
                  scores,
                  recommendation: recommendation ?? '',
                  comment,
                })}
              >
                {alreadyScored ? 'Update rating' : 'Submit rating'}
              </Button>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  )
}

export function JudgingPanel(): ReactElement {
  const { hackathonId } = useParams<{ hackathonId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [confirmTemplate, setConfirmTemplate] = useState(false)
  const [submittingIdea, setSubmittingIdea] = useState<string | null>(null)
  const eligibility = useNominationEligibility()
  const canManageJudging = user !== null && PermissionService.isManagerOrAbove(user)

  const { data: judges, isLoading: judgeStatusLoading, error: judgeStatusError } = useQuery({
    queryKey: ['hackathon-judges', hackathonId],
    queryFn: () => JudgingService.getJudges(hackathonId!),
    enabled: Boolean(hackathonId && user),
    staleTime: 60 * 1000,
  })
  const isAssignedJudge = (judges ?? []).some((judge) => judge.userId === user?.id)
  const canScore = isAssignedJudge || eligibility.data?.canReview === true
  const canJudge = canManageJudging || canScore

  const { data: criteria, isLoading: criteriaLoading, error: criteriaError } = useQuery({
    queryKey: ['voting-criteria', hackathonId],
    queryFn: () => VotingService.getCriteria(hackathonId!),
    enabled: Boolean(hackathonId && canJudge),
    staleTime: 5 * 60 * 1000,
  })
  const { data: nominations, isLoading: ideasLoading, error: ideasError } = useQuery({
    queryKey: ['judging-ideas', hackathonId, user?.id],
    queryFn: () => loadAllNominations(hackathonId!),
    enabled: Boolean(hackathonId && canJudge),
    staleTime: 2 * 60 * 1000,
  })
  const { data: myScores, isLoading: scoresLoading, error: scoresError } = useQuery({
    queryKey: ['my-judge-scores', hackathonId],
    queryFn: () => JudgingService.getMyScores(hackathonId!),
    enabled: Boolean(hackathonId && canScore),
    staleTime: 60 * 1000,
  })

  const templateMutation = useMutation({
    mutationFn: () => VotingService.applyAwardTemplate(hackathonId!),
    onSuccess: (configured) => {
      queryClient.setQueryData(['voting-criteria', hackathonId], configured)
      setConfirmTemplate(false)
      notifications.show({ title: 'Evaluation form ready', message: 'The three award-category criteria are ready.', color: 'teal' })
    },
    onError: (error) => notifications.show({ title: 'Error', message: error instanceof Error ? error.message : 'Unable to configure the evaluation form.', color: 'red' }),
  })

  const ownScores = (myScores ?? []).filter((score) => score.judgeId === user?.id)
  const scoredIdeaIds = new Set(ownScores.filter((score) =>
    (criteria?.length ?? 0) > 0 && criteria!.every((criterion) => ownScores.some((entry) => entry.ideaId === score.ideaId && entry.criterionId === criterion.id))
  ).map((score) => score.ideaId))

  const scoreIdeaMutation = useMutation({
    mutationFn: async (submission: ScoreSubmission) => {
      const note = [`Recommendation: ${submission.recommendation}`, submission.comment.trim()]
        .filter(Boolean)
        .join('\n\n')
      const saved = await JudgingService.submitEvaluation(hackathonId!, {
        ideaId: submission.ideaId,
        scores: Object.entries(submission.scores).map(([criterionId, score]) => ({ criterionId, score: Number(score) })),
        comment: note,
      })
      return { ideaId: submission.ideaId, saved }
    },
    onSuccess: ({ ideaId, saved }) => {
      queryClient.setQueryData<JudgeScore[]>(['my-judge-scores', hackathonId], (current = []) =>
        [...current.filter((score) => score.ideaId !== ideaId), ...saved])
      setSubmittingIdea(null)
      void Promise.all(['score-summary', 'all-judge-scores'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, hackathonId] })))
      notifications.show({
        title: 'Rating recorded',
        message: 'The weighted total and committee ranking have been updated.',
        color: 'teal',
      })
    },
    onError: (error) => {
      setSubmittingIdea(null)
      notifications.show({
        title: 'Rating not recorded',
        message: error instanceof Error ? error.message : 'Please try again.',
        color: 'red',
      })
    },
  })

  const deleteRatingMutation = useMutation({
    mutationFn: (ideaId: string) => JudgingService.deleteEvaluation(hackathonId!, ideaId),
    onSuccess: (_, ideaId) => {
      queryClient.setQueryData<JudgeScore[]>(['my-judge-scores', hackathonId], (current = []) =>
        current.filter((score) => score.ideaId !== ideaId))
      void Promise.all(['score-summary', 'all-judge-scores'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, hackathonId] })))
      setSubmittingIdea(null)
      notifications.show({ title: 'Rating deleted', message: 'The weighted total and committee ranking have been updated.', color: 'teal' })
    },
    onError: () => {
      setSubmittingIdea(null)
      notifications.show({ title: 'Error', message: 'Unable to save changes. Please try again.', color: 'red' })
    },
  })

  if (judgeStatusLoading || eligibility.isLoading) {
    return <Center py={100}><Loader size="lg" /></Center>
  }

  if (judgeStatusError) return <Alert color="red">Unable to verify committee access. Please reload and try again.</Alert>

  if (!canJudge) {
    return (
      <Container size="sm" py={80}>
        <Center>
          <Stack align="center" gap="md">
            <ThemeIcon size={72} radius="xl" variant="light" color="red"><IconAlertCircle size={34} /></ThemeIcon>
            <Title order={2}>Committee Access Required</Title>
            <Text ta="center" c="dimmed">Verified roster HoDs, assigned committee members and award managers can open this evaluation form.</Text>
            <Button variant="light" onClick={() => navigate(`/awards/${hackathonId}`)}>Back to award event</Button>
          </Stack>
        </Center>
      </Container>
    )
  }

  const isLoading = criteriaLoading || ideasLoading || scoresLoading
  const error = criteriaError ?? ideasError ?? scoresError
  const ideas: Idea[] = nominations ?? []
  const submittedIdeas = ideas.filter((idea) => ['submitted', 'in-progress', 'completed'].includes(idea.status))
    .map((idea) => ({ ...idea, category: normalizeDigitalPioneerTrack(idea.category, idea.tags ?? []) }))
  const tracks = DIGITAL_PIONEER_TRACKS.map((track) => ({
    ...track,
    ideas: submittedIdeas.filter((idea) => idea.category === track.value),
  }))
  const criteriaReady = officialCriteria(criteria ?? [])

  return (
    <Container size={1240} py={{ base: 'md', md: 'xl' }} className="dp-page">
      <Stack gap="xl">
        <Group justify="space-between" align="flex-end">
          <div>
            <Group gap="xs" mb="md">
              <ActionIcon variant="subtle" aria-label="Back to award event" onClick={() => navigate(`/awards/${hackathonId}`)}>
                <IconArrowLeft size={18} />
              </ActionIcon>
              <Text className="dp-section-label" style={{ marginBottom: 0 }}>2026 Digital Pioneer · Committee</Text>
            </Group>
            <h1 className="dp-section-title">Committee Scoring</h1>
          </div>
          {canManageJudging ? <Tooltip label="Open committee ranking">
            <Button
              variant="light"
              color="grape"
              leftSection={<IconTrophy size={17} />}
              onClick={() => navigate(`/hackathons/${hackathonId}/leaderboard`)}
            >
              View ranking
            </Button>
          </Tooltip> : null}
        </Group>

        {!canScore ? <Alert styles={{ root: { backgroundColor: 'rgba(255, 255, 255, 0.12)' }, message: { color: '#fff' } }}>You have manager access to review nominations. Assign yourself as a committee member in award settings to submit ratings.</Alert> : null}
        <Card className="dp-rules-panel" p="lg">
          <Grid align="center">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Group gap="sm"><IconScale size={20} /><Text fw={800}>Official weighting</Text></Group>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><Text>Customer Values / Innovation: 40% · 30% · 30%. Collaboration: 30% · 35% · 35%. Each nomination uses its Individual or Team criteria.</Text></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Badge key={criteriaReady ? 'ready' : 'pending'} color={criteriaReady ? 'teal' : 'orange'} variant="light">
                {criteriaReady ? 'Ready' : 'Check setup'}
              </Badge>
            </Grid.Col>
          </Grid>
        </Card>

        {isLoading ? (
          <Center py={80}><Stack align="center"><Loader /><Text c="dimmed">Loading nominations…</Text></Stack></Center>
        ) : null}
        {error ? <Alert color="red" icon={<IconAlertCircle size={18} />}>{error instanceof Error ? error.message : 'Unable to load evaluation data.'}</Alert> : null}
        {!isLoading && !error && !criteriaReady ? (
          <Alert color="orange" icon={<IconAlertCircle size={18} />}>
            <Text>Configure the three award-category criteria before scoring. Historical ratings remain stored and must be reassessed against the new criteria.</Text>
            {canManageJudging && <Group mt="md"><Button onClick={() => setConfirmTemplate(true)}>Apply 2026 DPA template</Button><Button variant="light" onClick={() => navigate(`/awards/${hackathonId}`)}>Manage evaluation criteria</Button></Group>}
            {canManageJudging && confirmTemplate && <Stack mt="md" gap="sm">
              <Text>Add the three award-category criteria? Historical criteria and ratings are preserved; new totals use complete ratings under the new criteria.</Text>
              <Group><Button loading={templateMutation.isPending} onClick={() => templateMutation.mutate()}>Confirm official criteria</Button><Button variant="default" onClick={() => setConfirmTemplate(false)}>Cancel</Button></Group>
            </Stack>}
          </Alert>
        ) : null}
        {!isLoading && !error && criteriaReady ? tracks.map((track) => (
          <Stack key={track.value} gap="md" component="section" aria-label={track.label}>
            <Text component="h2" size="xl" fw={800} m={0} c="white">{track.label}</Text>
            {track.ideas.length === 0 ? (
              <Text c="white">No nominations in this category yet.</Text>
            ) : track.ideas.map((idea) => (
              <IdeaJudgingCard
                key={`${idea.id}-${ownScores.filter((score) => score.ideaId === idea.id).map((score) => `${score.id}:${score.score}:${score.comment}`).join()} `}
                savedScores={ownScores.filter((score) => score.ideaId === idea.id)}
                canSubmitRating={canScore}
                idea={idea}
                criteria={criteriaForNomination(criteria ?? [], idea)}
                alreadyScored={scoredIdeaIds.has(idea.id)}
                isSubmitting={submittingIdea === idea.id}
                onDelete={() => { setSubmittingIdea(idea.id); deleteRatingMutation.mutate(idea.id) }}
                onSubmit={(submission) => {
                  setSubmittingIdea(idea.id)
                  scoreIdeaMutation.mutate(submission)
                }}
              />
            ))}
          </Stack>
        )) : null}
      </Stack>
    </Container>
  )
}
