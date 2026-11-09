import {
  Container,
  Stack,
  Title,
  Text,
  Card,
  Group,
  Button,
  Grid,
  TextInput,
  Textarea,
  NumberInput,
  MultiSelect,
  Select,
  Alert,
  LoadingOverlay,
} from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import {
  IconArrowLeft,
  IconDeviceFloppy,
  IconCalendar,
  IconTarget,
  IconAlertCircle,
} from '@tabler/icons-react'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm } from '@mantine/form'
import { useAuthStore } from '../store/authStore'
import { HackathonService } from '../services/hackathonService'
import { useHackathonStore } from '../store/hackathonStore'
import { notifications } from '@mantine/notifications'

interface HackathonEditForm {
  title: string
  description: string
  start_date: Date
  end_date: Date
  max_team_size: number
  allowed_participants: number
  registration_key: string
  status: 'draft' | 'open' | 'running' | 'completed'
  tags: string[]
  prizes: string[]
  rules: string
  banner_url?: string
}

export function HackathonEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { hackathons, updateHackathon } = useHackathonStore()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hackathon, setHackathon] = useState<typeof hackathons[0] | null>(null)

  // Form configuration
  const form = useForm<HackathonEditForm>({
    initialValues: {
      title: '',
      description: '',
      start_date: new Date(),
      end_date: new Date(),
      max_team_size: 4,
      allowed_participants: 100,
      registration_key: '',
      status: 'draft',
      tags: [],
      prizes: [''],
      rules: '',
      banner_url: '',
    },
    validate: {
      title: (value) => (value.length < 3 ? 'Title must be at least 3 characters' : null),
      description: (value) => (value.length < 10 ? 'Description must be at least 10 characters' : null),
      // Allow past dates for hackathons (removed past date restriction)
      start_date: () => null,
      end_date: (value, values) =>
        value <= values.start_date ? 'End date must be after start date' : null,
      max_team_size: (value) => (value < 2 || value > 20 ? 'Team size must be between 2 and 20' : null),
      allowed_participants: (value) => (value < 1 ? 'Must allow at least 1 participant' : null),

    },
  })

  // Load hackathon data
  useEffect(() => {
    const loadHackathon = async () => {
      if (!id) {
        navigate('/hackathons')
        return
      }

      setLoading(true)
      try {
        // Direct links and refreshes must work before the shared store has loaded.
        const foundHackathon = hackathons.find(h => h.id === id) ?? await HackathonService.getHackathon(id)
        if (!foundHackathon) {
          notifications.show({
            title: 'Award campaign not found',
            message: 'The award campaign you are trying to edit could not be found.',
            color: 'red',
          })
          navigate('/hackathons')
          return
        }

        setHackathon(foundHackathon)

        // Populate form with hackathon data
        form.setValues({
          title: foundHackathon.title || '',
          description: foundHackathon.description || '',
          start_date: new Date(foundHackathon.startDate),
          end_date: new Date(foundHackathon.endDate),
          max_team_size: foundHackathon.maxTeamSize || 4,
          allowed_participants: foundHackathon.allowedParticipants || 100,
          registration_key: foundHackathon.registrationKey || '',
          status: foundHackathon.status || 'draft',
          tags: foundHackathon.tags || [],
          prizes: foundHackathon.prizes || [''],
          rules: foundHackathon.rules || '',
          banner_url: foundHackathon.bannerUrl || '',
        })
      } catch (error) {
        console.error('Error loading hackathon:', error)
        notifications.show({
          title: 'Error',
          message: 'Failed to load award campaign data.',
          color: 'red',
        })
        navigate('/hackathons')
      } finally {
        setLoading(false)
      }
    }

    loadHackathon()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hackathons, user, navigate])

  const handleSubmit = async (values: HackathonEditForm) => {
    if (!hackathon || !user) return

    setSaving(true)
    try {
      // Convert dates to ISO strings, ensuring they're valid Date objects
      const startDate = values.start_date instanceof Date ? values.start_date : new Date(values.start_date)
      const endDate = values.end_date instanceof Date ? values.end_date : new Date(values.end_date)

      const updatedHackathon = {
        title: values.title,
        description: values.description,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        maxTeamSize: values.max_team_size,
        allowedParticipants: values.allowed_participants,
        tags: values.tags,
        prizes: values.prizes,
        rules: values.rules,
        bannerUrl: values.banner_url || null,
      }

      // Check if status changed for special notification
      const statusChanged = hackathon.status !== values.status

      await updateHackathon(hackathon.id, updatedHackathon)

      if (statusChanged) {
        try {
          const changed = await HackathonService.transitionStatus(hackathon.id, values.status)
          setHackathon(changed)
        } catch (cause) {
          notifications.show({ title: 'Campaign details saved', message: cause instanceof Error ? cause.message : 'Unable to change campaign status.', color: 'orange' })
          navigate(`/awards/${id}`)
          return
        }
      }

      // Show success notification with status change info
      let message = 'Award campaign updated successfully.'
      if (statusChanged) {
        const statusLabels = {
          'draft': 'Draft (not visible)',
          'open': 'Open for registration',
          'running': 'Currently running',
          'completed': 'Completed'
        }
        message += ` Status changed to: ${statusLabels[values.status]}.`
      }

      notifications.show({
        title: 'Success!',
        message,
        color: 'green',
      })

      navigate(`/awards/${id}`)
    } catch (error) {
      console.error('Error updating hackathon:', error)
      notifications.show({
        title: 'Error',
        message: 'Failed to update award campaign. Please try again.',
        color: 'red',
      })
    } finally {
      setSaving(false)
    }
  }

  const availableTags = [
    'AI/ML', 'Blockchain', 'IoT', 'FinTech', 'HealthTech', 'EdTech',
    'Gaming', 'Mobile', 'Web', 'DevOps', 'Security', 'Data Science',
    'AR/VR', 'Sustainability', 'Social Impact', 'Hardware'
  ]

  if (loading) {
    return (
      <Container className="dp-page" size="lg" py="xl">
        <LoadingOverlay visible />
        <div style={{ height: '400px' }} />
      </Container>
    )
  }

  if (!hackathon) {
    return (
      <Container className="dp-page" size="lg" py="xl">
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Award Campaign Not Found"
          color="red"
        >
          The award campaign you are trying to edit could not be found.
        </Alert>
      </Container>
    )
  }

  return (
    <Container className="dp-page" size="lg" py="xl">
      <Stack gap="xl">
        {/* Header */}
        <div>
          <Group mb="md">
            <Button
              variant="light"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate(`/awards/${id}`)}
            >
              Back to award campaign
            </Button>
          </Group>

          <Title order={1} mb="xs">
            Edit Award Campaign
          </Title>
          <Text c="dimmed" size="lg">
            Update your award campaign details and settings
          </Text>
        </div>

        {/* Edit Form */}
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="lg">
            {/* Basic Information */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Basic Information</Title>
              <Stack gap="md">
                <TextInput
                  label="Award campaign title"
                  placeholder="Enter award campaign title"
                  required
                  {...form.getInputProps('title')}
                />

                <Textarea
                  label="Description"
                  placeholder="Describe your award campaign..."
                  required
                  minRows={4}
                  {...form.getInputProps('description')}
                />

                <Grid>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <DateTimePicker
                      label="Start Date & Time"
                      placeholder="Select start date and time"
                      required
                      leftSection={<IconCalendar size={16} />}
                      {...form.getInputProps('start_date')}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <DateTimePicker
                      label="End Date & Time"
                      placeholder="Select end date and time"
                      required
                      leftSection={<IconCalendar size={16} />}
                      {...form.getInputProps('end_date')}
                    />
                  </Grid.Col>
                </Grid>

                <Select
                  label="Campaign status"
                  placeholder="Select current status"
                  required
                  
                  data={(['draft', 'open', 'running', 'completed'] as const)
                    .filter((status, index, statuses) => status === hackathon.status || index === statuses.indexOf(hackathon.status) + 1)
                    .map((status) => ({ value: status, label: status.charAt(0).toUpperCase() + status.slice(1) }))}
                  {...form.getInputProps('status')}
                />

                <TextInput
                  label="Banner Image URL"
                  placeholder="https://…"
                  {...form.getInputProps('banner_url')}
                />
              </Stack>
            </Card>

            {/* Status Information */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Status Guide</Title>
              <Stack gap="sm">
                <Group>
                  <Text fw={500} c={form.values.status === 'draft' ? 'blue' : 'dimmed'}>📝 Draft:</Text>
                  <Text size="sm" c={form.values.status === 'draft' ? undefined : 'dimmed'}>
                    The campaign is not visible to participants. Use this for preparation.
                  </Text>
                </Group>
                <Group>
                  <Text fw={500} c={form.values.status === 'open' ? 'blue' : 'dimmed'}>🚀 Open:</Text>
                  <Text size="sm" c={form.values.status === 'open' ? undefined : 'dimmed'}>
                    Registration is available. Participants can view and join the campaign.
                  </Text>
                </Group>
                <Group>
                  <Text fw={500} c={form.values.status === 'running' ? 'blue' : 'dimmed'}>⚡ Running:</Text>
                  <Text size="sm" c={form.values.status === 'running' ? undefined : 'dimmed'}>
                    Event is in progress. Participants can submit ideas and collaborate.
                  </Text>
                </Group>
                <Group>
                  <Text fw={500} c={form.values.status === 'completed' ? 'blue' : 'dimmed'}>✅ Completed:</Text>
                  <Text size="sm" c={form.values.status === 'completed' ? undefined : 'dimmed'}>
                    Event has finished. Results can be announced and archives are available.
                  </Text>
                </Group>
              </Stack>
            </Card>

            {/* Participation Settings */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Participation Settings</Title>
              <Stack gap="md">
                <Grid>

                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <NumberInput
                      label="Maximum Participants"
                      placeholder="Enter participant limit"
                      min={1}
                      required
                      leftSection={<IconTarget size={16} />}
                      {...form.getInputProps('allowed_participants')}
                    />
                  </Grid.Col>
                </Grid>

                <TextInput
                  label="Registration Key"
                  placeholder="Enter registration key (optional)"
                  description="Participants will need this key to register"
                  readOnly
                  {...form.getInputProps('registration_key')}
                />
              </Stack>
            </Card>

            {/* Categories & Tags */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Categories & Tags</Title>
              <MultiSelect
                label="Tags"
                placeholder="Select relevant tags"
                data={availableTags}
                
                {...form.getInputProps('tags')}
              />
            </Card>

            {/* Prizes */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Prizes</Title>
              <Stack gap="sm">
                {form.values.prizes.map((_, index) => (
                  <Group key={index}>
                    <TextInput
                      placeholder={`Prize ${index + 1} (e.g., $1000 First Place)`}
                      style={{ flex: 1 }}
                      value={form.values.prizes[index]}
                      onChange={(event) => {
                        const newPrizes = [...form.values.prizes]
                        newPrizes[index] = event.currentTarget.value
                        form.setFieldValue('prizes', newPrizes)
                      }}
                    />
                    {(
                      <Button
                        variant="light"
                        color="red"
                        size="sm"
                        onClick={() => {
                          const newPrizes = form.values.prizes.filter((_, i) => i !== index)
                          form.setFieldValue('prizes', newPrizes)
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </Group>
                ))}
                <Button
                  variant="light"
                  onClick={() => {
                    form.setFieldValue('prizes', [...form.values.prizes, ''])
                  }}
                >
                  Add Prize
                </Button>
              </Stack>
            </Card>

            {/* Rules */}
            <Card withBorder radius="md" p="lg">
              <Title order={3} mb="md">Rules & Guidelines</Title>
              <Textarea
                label="Rules"
                placeholder="Enter award guidelines and guidelines..."
                minRows={6}
                
                {...form.getInputProps('rules')}
              />
            </Card>

            {/* Action Buttons */}
            <Group justify="flex-end">
              <Button
                variant="light"
                onClick={() => navigate(`/awards/${id}`)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                leftSection={<IconDeviceFloppy size={16} />}
                loading={saving}
              >
                Save Changes
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  )
}
