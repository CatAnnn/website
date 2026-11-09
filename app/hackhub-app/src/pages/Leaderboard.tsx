import { Fragment, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ActionIcon, Alert, Badge, Button, Card, Center, Container, Group, Loader, Select, Stack, Table, Text } from '@mantine/core'
import { IconArrowLeft, IconChevronDown, IconChevronUp, IconDownload } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtime } from '../hooks/useRealtime'
import { JudgingService } from '../services/judgingService'
import { VotingService } from '../services/votingService'
import { useAuthStore } from '../store/authStore'
import { PermissionService } from '../utils/permissions'
import { loadAllNominations, rankCommitteeScores } from '../utils/committeeScoring'
import { DIGITAL_PIONEER_TRACKS, normalizeDigitalPioneerTrack } from '../config/digitalPioneer'
import './DigitalPioneer.css'

interface LeaderboardProps { hackathonId?: string }

function downloadCsv(cells: string[][]): void {
  const csv = '\uFEFF' + cells.map((row) => row.map((cell) => {
    const safe = /^[=+@\-\t\r]/.test(cell) ? `'${cell}` : cell
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'digital-pioneer-committee-ranking.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function Leaderboard({ hackathonId: propHackathonId }: LeaderboardProps = {}): ReactElement {
  const { hackathonId: routeHackathonId } = useParams<{ hackathonId: string }>()
  const hackathonId = propHackathonId ?? routeHackathonId
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const canManage = user !== null && PermissionService.isManagerOrAbove(user)
  const queryClient = useQueryClient()
  const { isConnected, subscribeToHackathonUpdates } = useRealtime()
  useEffect(() => {
    if (!hackathonId || !canManage || !isConnected) return
    const refreshScores = () => {
      void Promise.all(['score-summary', 'all-judge-scores', 'hackathon-judges'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, hackathonId] }),
      ))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeToHackathonUpdates(hackathonId, (event) => {
      if (event.event !== 'JUDGE_SCORES_UPDATED' || timer !== undefined) return
      timer = setTimeout(() => { timer = undefined; refreshScores() }, 150)
    })
    // Recover any updates missed while connecting or reconnecting.
    refreshScores()
    return () => { clearTimeout(timer); unsubscribe?.() }
  }, [hackathonId, canManage, isConnected, subscribeToHackathonUpdates, queryClient])
  const [category, setCategory] = useState<string | null>(null)
  const [expandedIdeas, setExpandedIdeas] = useState<Set<string>>(() => new Set())
  const toggleRatings = (ideaId: string) => setExpandedIdeas((current) => {
    const next = new Set(current)
    if (next.has(ideaId)) next.delete(ideaId)
    else next.add(ideaId)
    return next
  })
  const summary = useQuery({ queryKey: ['score-summary', hackathonId, user?.id], queryFn: () => JudgingService.getScoreSummary(hackathonId!), enabled: Boolean(hackathonId && canManage), staleTime: 30000, refetchInterval: 30000 })
  const ideas = useQuery({ queryKey: ['judging-ideas', hackathonId, user?.id], queryFn: () => loadAllNominations(hackathonId!), enabled: Boolean(hackathonId && canManage), staleTime: 60000 })
  const details = useQuery({ queryKey: ['all-judge-scores', hackathonId], queryFn: () => JudgingService.getAllScores(hackathonId!), enabled: Boolean(hackathonId && canManage && expandedIdeas.size), refetchInterval: 30000 })
  const judges = useQuery({ queryKey: ['hackathon-judges', hackathonId], queryFn: () => JudgingService.getJudges(hackathonId!), enabled: Boolean(hackathonId && canManage && expandedIdeas.size) })
  const criteria = useQuery({ queryKey: ['voting-criteria', hackathonId], queryFn: () => VotingService.getCriteria(hackathonId!), enabled: Boolean(hackathonId && canManage && expandedIdeas.size) })
  const nominations = new Map((ideas.data ?? []).map((idea) => [idea.id, {
    ...idea, category: normalizeDigitalPioneerTrack(idea.category, idea.tags ?? []),
  }]))
  const tracks = DIGITAL_PIONEER_TRACKS.filter((track) => !category || track.value === category).map((track) => ({
    ...track,
    rows: rankCommitteeScores((summary.data ?? []).filter((score) => nominations.get(score.ideaId)?.category === track.value)),
  }))
  const rows = tracks.flatMap((track) => track.rows)
  const error = summary.error ?? ideas.error
  const detailError = details.error ?? judges.error ?? criteria.error
  const exportRows = [['Rank', 'Nomination', 'Category', 'Committee total / 10', 'Completed judges', 'Associate votes'], ...rows.map((score) => [String(score.displayRank ?? ''), score.ideaTitle, nominations.get(score.ideaId)?.category ?? '', score.panelScore?.toFixed(2) ?? 'Not scored', String(score.judgeCount), String(score.voteCount)])]

  if (!canManage) return <Container size="sm" py="xl"><Alert color="blue" title="Manager Access Required">Committee rankings and individual ratings are available to award managers.</Alert></Container>

  return <Container size={1320} w="100%" miw={0} style={{ maxWidth: 1320 }} py={{ base: 'md', md: 'xl' }} className="dp-page"><Stack gap="xl" miw={0}>
    <Group justify="space-between" align="flex-end">
      <div><Group gap="xs" mb="md"><ActionIcon variant="subtle" aria-label="Back to award event" onClick={() => navigate(`/awards/${hackathonId}`)}><IconArrowLeft size={18} /></ActionIcon><Text className="dp-section-label" mb={0}>Committee view · Live totals</Text></Group>
        <h1 className="dp-section-title">Committee Ranking</h1><Text className="dp-section-copy" mt="md">Average of completed committee evaluations: Behavior Demonstration 70% + Business Impact 30%. Equal totals share a rank; associate votes do not affect committee totals.</Text></div>
      <Button variant="light" color="grape" leftSection={<IconDownload size={17} />} disabled={!rows.length || Boolean(error)} onClick={() => downloadCsv(exportRows)}>Export CSV</Button>
    </Group>
    <Select label="Award category" placeholder="All categories" clearable value={category} onChange={setCategory} data={DIGITAL_PIONEER_TRACKS.map((track) => track.value)} maw={360} />
    {summary.isLoading || ideas.isLoading ? <Center py={60}><Loader /></Center> : error ? <Alert color="red">{error instanceof Error ? error.message : 'Unable to load ranking.'}</Alert> : tracks.map((track) => (
      <Stack key={track.value} gap="md" component="section" aria-label={track.label}>
        <Text component="h2" size="xl" fw={800} m={0} c="white">{track.label} · {track.labelZh}</Text>
        {!track.rows.length ? <Text c="dimmed">No nominations in this category yet.</Text> : (
          <Card className="dp-ranking-shell" data-track={track.shorthand} p={0} miw={0} maw="100%" style={{ overflow: 'hidden', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}>
            <Table.ScrollContainer type="native" minWidth={850}>
              <Table verticalSpacing="md" horizontalSpacing="lg" highlightOnHover highlightOnHoverColor="transparent" c="white">
                <Table.Thead><Table.Tr>{['Rank', 'Nomination', 'Category', 'Committee total', 'Completed judges', 'Associate votes', 'Ratings'].map((label) => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
                <Table.Tbody>
                  {track.rows.map((score) => {
                    const expanded = expandedIdeas.has(score.ideaId)
                    const selectedScores = (details.data ?? []).filter((rating) => rating.ideaId === score.ideaId)
                    const judgeGroups = [...new Set([...(judges.data ?? []).map((judge) => judge.userId), ...selectedScores.map((rating) => rating.judgeId)])]
                    const detailsId = `committee-ratings-${score.ideaId}`
                    return <Fragment key={score.ideaId}>
                      <Table.Tr>
                        <Table.Td>{score.displayRank === null ? '—' : `#${score.displayRank}`}</Table.Td>
                        <Table.Td><Text fw={700} c="white">{score.ideaTitle}</Text><Text size="sm" c="white">{nominations.get(score.ideaId)?.projectAttachments?.find((attachment) => attachment.type === 'nomination')?.name}</Text></Table.Td>
                        <Table.Td><Badge variant="light" bg="transparent" c="white">{track.label}</Badge></Table.Td>
                        <Table.Td>
                          <Button variant="subtle" size="compact-sm" bg="transparent" c="white" fw={800} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} rightSection={expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />} onClick={() => toggleRatings(score.ideaId)}>
                            {score.panelScore?.toFixed(2) ?? 'Not scored'}
                          </Button>
                        </Table.Td>
                        <Table.Td>{score.judgeCount}</Table.Td><Table.Td>{score.voteCount}</Table.Td>
                        <Table.Td><Button variant="subtle" size="xs" bg="transparent" c="white" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={() => toggleRatings(score.ideaId)}>View ratings</Button></Table.Td>
                      </Table.Tr>
                      {expanded && <Table.Tr><Table.Td colSpan={7}>
                        <Stack id={detailsId} role="region" aria-label={`Committee ratings · ${score.ideaTitle}`}>
                          <Text fw={800}>Committee ratings · {score.ideaTitle}</Text>
                          {details.isLoading || judges.isLoading || criteria.isLoading ? <Loader /> : detailError ? <Alert color="red">Unable to load individual ratings. Please reload and try again.</Alert> : !judgeGroups.length ? <Text c="white">No committee ratings have been submitted for this nomination.</Text> : (
                            <Table verticalSpacing="md" c="white">
                              <Table.Thead><Table.Tr><Table.Th>Committee member</Table.Th>{(criteria.data ?? []).map((criterion) => <Table.Th key={criterion.id}>{criterion.name} ({criterion.weight}%)</Table.Th>)}<Table.Th>Weighted total / 10</Table.Th><Table.Th>Recommendation & comments</Table.Th></Table.Tr></Table.Thead>
                              <Table.Tbody>{judgeGroups.map((judgeId) => {
                                const scores = selectedScores.filter((rating) => rating.judgeId === judgeId)
                                const complete = (criteria.data?.length ?? 0) > 0 && criteria.data!.every((criterion) => scores.some((rating) => rating.criterionId === criterion.id))
                                const total = (criteria.data ?? []).reduce((sum, criterion) => sum + (scores.find((rating) => rating.criterionId === criterion.id)?.score ?? 0) * criterion.weight / 100, 0)
                                return <Table.Tr key={judgeId}>
                                  <Table.Td>{judges.data?.find((judge) => judge.userId === judgeId)?.name ?? judgeId}</Table.Td>
                                  {(criteria.data ?? []).map((criterion) => <Table.Td key={criterion.id}>{scores.find((rating) => rating.criterionId === criterion.id)?.score ?? 'Pending'}</Table.Td>)}
                                  <Table.Td>{complete ? total.toFixed(2) : 'Incomplete'}</Table.Td>
                                  <Table.Td><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{[...new Set(scores.map((rating) => rating.comment).filter(Boolean))].join('\n\n') || '—'}</Text></Table.Td>
                                </Table.Tr>
                              })}</Table.Tbody>
                            </Table>
                          )}
                        </Stack>
                      </Table.Td></Table.Tr>}
                    </Fragment>
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        )}
      </Stack>
    ))}
  </Stack></Container>
}
