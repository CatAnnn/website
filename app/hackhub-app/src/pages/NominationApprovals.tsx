import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Anchor, Badge, Button, Card, Checkbox, Container, Group, Loader, Modal, Stack, Table, Tabs, Text, Textarea, Title } from '@mantine/core'
import { IdeaService, type Idea } from '../services/ideaService'
import { NominationEvidence } from '../components/DigitalPioneer/NominationEvidence'
import { useAuthStore } from '../store/authStore'
import { useNominationEligibility } from '../hooks/useNominationEligibility'
import { DIGITAL_PIONEER_TRACKS } from '../config/digitalPioneer'
import { NominationProgress } from '../components/DigitalPioneer/NominationProgress'
import { nominationState } from '../lib/nominationStatus'
import './DigitalPioneer.css'

function trackName(idea: Idea) {
  return DIGITAL_PIONEER_TRACKS.find((track) => track.value === idea.category)?.label ?? idea.category
}

export function NominationApprovals({ reviewMode = false }: { reviewMode?: boolean }) {
  const { user } = useAuthStore()
  const eligibility = useNominationEligibility()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string[]>([])
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  const [decisionItems, setDecisionItems] = useState<Array<{ id: string; version: number }>>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const nominations = useQuery({
    queryKey: ['nomination-inbox', user?.id, reviewMode],
    queryFn: () => reviewMode ? IdeaService.getNominationApprovals() : IdeaService.getMyNominations(),
    enabled: Boolean(user) && (!reviewMode || eligibility.data?.canReview === true),
    refetchInterval: 30_000,
    retry: false,
  })
  const ideas = nominations.data ?? []
  const current = ideas.find((idea) => idea.id === params.get('id'))
  const pending = ideas.filter((idea) => idea.approvalStatus === 'pending')
  const selectedPending = pending.filter((idea) => selected.includes(idea.id))
  const targets = current ? (current.approvalStatus === 'pending' ? [current] : []) : selectedPending
  const open = (id?: string) => setParams(id ? { id } : {})

  const submitDecision = async () => {
    if (!decision || busy || decisionItems.length === 0 || (decision === 'rejected' && !reason.trim())) return
    setBusy(true)
    setError(null)
    try {
      await IdeaService.reviewNominations(decisionItems, decision, reason.trim())
      setNotice(`${decisionItems.length} nomination(s): ${decision === 'approved' ? 'Approved' : 'Rejected — revise'}`)
      setSelected([])
      setDecision(null)
      setReason('')
      await nominations.refetch()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save the decision. Refresh and try again.')
      await nominations.refetch()
    } finally {
      setBusy(false)
    }
  }

  const actions = reviewMode && targets.length > 0 && <Group>
    <Button color="green" onClick={() => { setReason(''); setDecisionItems(targets.map((idea) => ({ id: idea.id, version: idea.approvalVersion ?? 0 }))); setDecision('approved') }} disabled={busy}>Approve{!current && ` (${targets.length})`}</Button>
    <Button color="red" onClick={() => { setReason(''); setDecisionItems(targets.map((idea) => ({ id: idea.id, version: idea.approvalVersion ?? 0 }))); setDecision('rejected') }} disabled={busy}>Reject for revision{!current && ` (${targets.length})`}</Button>
  </Group>

  if (reviewMode && eligibility.isPending) return <Container py="xl"><Loader aria-label="Loading approval access" /></Container>
  if (reviewMode && !eligibility.data?.canReview) return <Container py="xl"><Alert color="orange">{eligibility.isError ? 'Unable to verify approval access. Please refresh.' : 'Your signed-in account is not assigned as a Nominating HoD.'}</Alert></Container>

  return <Container size={1240} py="xl" className="dp-page">
    <Card className="dp-form-shell dp-approval-shell" c="white" p={{ base: 'md', md: 'xl' }} radius="lg">
    <Stack>
      <Group justify="space-between"><Title order={2}>{reviewMode ? 'Nominating HoD Approvals' : 'My Nominations'}</Title><Button variant="light" onClick={() => void nominations.refetch()} loading={nominations.isFetching}>Refresh</Button></Group>
      {notice && <Alert color="green" role="status">{notice}</Alert>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {nominations.isError ? <Alert color="red">Unable to load nominations. Please refresh.</Alert>
        : nominations.isPending ? <Loader aria-label="Loading nominations" />
          : current ? <Card bg="transparent" c="white" p={0}>
            <Stack gap="xl">
              <Button variant="outline" radius="xl" w="fit-content" styles={{ root: { backgroundColor: 'transparent' } }} onClick={() => open()}>Go back</Button>
              <Title order={2}>{trackName(current)}</Title>
              <div><Text fw={700}>Name</Text><Text>{current.projectAttachments?.find((item) => item.type === 'nomination')?.nominatorName || current.projectAttachments?.find((item) => item.type === 'nomination')?.name || current.title}</Text></div>
              <Group justify="space-between" align="start">
                <Group align="start"><div><Text fw={700}>Created</Text><Text>{new Date(current.createdAt).toLocaleString()}</Text></div><div><Text fw={700}>Updated</Text><Text>{new Date(current.updatedAt).toLocaleString()}</Text></div><div><Text fw={700}>State</Text><Text>{nominationState(current)}</Text></div></Group>
              </Group>
              {current.approvalHeadName && <Text><strong>Nominating HoD: </strong>{current.approvalHeadName}</Text>}
              <NominationProgress idea={current} />
              {actions}
              {!reviewMode && current.approvalStatus === 'rejected' && <Button component={Link} to={`/nominate?edit=${encodeURIComponent(current.id)}`} w="fit-content">Edit and resubmit</Button>}
              <Tabs defaultValue="details">
                <Tabs.List><Tabs.Tab value="details">Details</Tabs.Tab><Tabs.Tab value="activity">Activity</Tabs.Tab><Tabs.Tab value="attachments">Attachments</Tabs.Tab></Tabs.List>
                <Tabs.Panel value="details" pt="lg"><Stack>
                  {current.projectAttachments?.filter((item) => item.type === 'nomination').map((item, index) => <Stack gap="xs" key={index}>
                    <Text><strong>{item.nominationType === 'team' ? 'Project Name: ' : 'Name: '}</strong>{item.name}</Text>
                    {item.nominationType === 'team' && <>
                      <Text><strong>NominatorName: </strong>{item.nominatorName}</Text>
                      <Text style={{ whiteSpace: 'pre-wrap' }}><strong>Core Team Member: </strong>{item.coreTeamMembers}</Text>
                    </>}
                    {item.employeeEmail && <Text><strong>Email: </strong>{item.employeeEmail}</Text>}
                    {item.nomineeOrgCode && <Text><strong>Department: </strong>{item.nomineeOrgCode}</Text>}
                    {item.nomineePosition && <Text><strong>Position: </strong>{item.nomineePosition}</Text>}
                    {item.nominatingHead && <Text><strong>Nominating HoD: </strong>{item.nominatingHead}</Text>}
                  </Stack>)}
                  <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{current.description}</Text>
                  {!current.teamId && !current.projectAttachments?.some((item) => item.type === 'nomination' && item.nominationType === 'team') && <Group>{current.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</Group>}
                </Stack></Tabs.Panel>
                <Tabs.Panel value="activity" pt="lg"><Stack>
                  <Text>Created: {new Date(current.createdAt).toLocaleString()}</Text>
                  <Text>Last updated: {new Date(current.updatedAt).toLocaleString()}</Text>
                  {current.approvalReviewedAt && <Text>{nominationState(current)}: {new Date(current.approvalReviewedAt).toLocaleString()}{current.approvalReviewerName && ` · ${current.approvalReviewerName}`}</Text>}
                  {current.approvalReason && <Text style={{ whiteSpace: 'pre-wrap' }}>{current.approvalReason}</Text>}
                </Stack></Tabs.Panel>
                <Tabs.Panel value="attachments" pt="lg"><Stack>
                  {current.projectAttachments?.filter((item) => item.type !== 'nomination').map((item, index) => <NominationEvidence key={`${current.id}-${index}`} attachment={item} />)}
                  {!current.projectAttachments?.some((item) => item.type !== 'nomination') && <Text>No attachments submitted.</Text>}
                </Stack></Tabs.Panel>
              </Tabs>
            </Stack>
          </Card> : <>
            {params.get('id') && <Alert color="orange">This nomination is no longer available. The current list is shown below.</Alert>}
            {reviewMode && <Group justify="space-between"><Checkbox label="Select all pending" checked={pending.length > 0 && selectedPending.length === pending.length} indeterminate={selectedPending.length > 0 && selectedPending.length < pending.length} disabled={pending.length === 0 || busy} onChange={(event) => setSelected(event.currentTarget.checked ? pending.map((idea) => idea.id) : [])} />{actions}</Group>}
            <Table.ScrollContainer minWidth={650}><Table verticalSpacing="md" highlightOnHover>
              <Table.Thead><Table.Tr>{reviewMode && <Table.Th>Select</Table.Th>}<Table.Th>Nomination</Table.Th><Table.Th>Created</Table.Th><Table.Th>State</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{ideas.map((idea) => <Table.Tr key={idea.id}>
                {reviewMode && <Table.Td><Checkbox aria-label={`Select ${idea.title}`} disabled={idea.approvalStatus !== 'pending' || busy} checked={selected.includes(idea.id)} onChange={(event) => { const checked = event.currentTarget.checked; setSelected((ids) => checked ? [...ids, idea.id] : ids.filter((id) => id !== idea.id)) }} /></Table.Td>}
                <Table.Td><Anchor component="button" onClick={() => open(idea.id)} ta="left" c="white"><Text fw={700}>{trackName(idea)}</Text><Text>{idea.projectAttachments?.find((item) => item.type === 'nomination')?.name || idea.title}</Text></Anchor></Table.Td>
                <Table.Td>{new Date(idea.createdAt).toLocaleString()}</Table.Td><Table.Td>{nominationState(idea)}</Table.Td>
              </Table.Tr>)}</Table.Tbody>
            </Table></Table.ScrollContainer>
            {ideas.length === 0 && <Text c="dimmed">{reviewMode ? 'No nominations assigned to you.' : 'You have not submitted a nomination yet.'}</Text>}
          </>}
    </Stack>
    </Card>
    <Modal opened={decision !== null} onClose={() => { if (!busy) setDecision(null) }} title={decision === 'approved' ? 'Approve Nominations' : 'Reject For Revision'} centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
      <Stack><Text>{decisionItems.length} nomination(s) selected.</Text><Textarea label={decision === 'rejected' ? 'Reason for revision' : 'Comment'} required={decision === 'rejected'} value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={2000} disabled={busy} />
        {error && <Alert color="red">{error}</Alert>}
        <Button onClick={() => void submitDecision()} loading={busy} disabled={decisionItems.length === 0 || (decision === 'rejected' && !reason.trim())}>Confirm</Button>
      </Stack>
    </Modal>
  </Container>
}
