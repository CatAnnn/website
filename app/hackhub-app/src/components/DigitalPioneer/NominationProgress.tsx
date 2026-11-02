import { Badge, Group, Stepper, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { Idea } from '../../services/ideaService'
import { nominationState } from '../../lib/nominationStatus'

export function NominationProgress({ idea }: { idea: Idea }) {
  const compact = useMediaQuery('(max-width: 48em)')
  if (!idea.approvalStatus) return <Badge color="blue">Submitted</Badge>
  const finished = idea.approvalStatus === 'approved' || idea.approvalStatus === 'rejected'
  return <>
    <Stepper active={finished ? 3 : 1} color={idea.approvalStatus === 'rejected' ? 'red' : 'blue'} size="sm" mt="lg" mb="lg" orientation={compact ? 'vertical' : 'horizontal'}>
      <Stepper.Step label="Created" />
      <Stepper.Step label="In approval" />
      <Stepper.Step label={finished ? nominationState(idea) : 'Decision'} />
    </Stepper>
    <Group><Badge color={idea.approvalStatus === 'rejected' ? 'red' : idea.approvalStatus === 'approved' ? 'green' : 'blue'}>{nominationState(idea)}</Badge></Group>
    {idea.approvalReason && <Text mt="sm" style={{ whiteSpace: 'pre-wrap' }}>{idea.approvalReason}</Text>}
  </>
}
