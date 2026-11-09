import { Avatar, Badge, Button, Card, Container, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useAuthStore } from '../store/authStore'

export function Profile() {
  const { user, updateProfile } = useAuthStore()
  const [saving, setSaving] = useState(false)
  const form = useForm({
    initialValues: { name: user?.name ?? '' },
    validate: { name: (value) => value.trim().length < 2 ? 'Enter your full name.' : null },
  })

  const save = async ({ name }: { name: string }) => {
    setSaving(true)
    try {
      await updateProfile({ name: name.trim() })
      notifications.show({ title: 'Profile updated', message: 'Your name has been saved.', color: 'green' })
    } catch (error) {
      notifications.show({ title: 'Unable to save', message: error instanceof Error ? error.message : 'Please try again.', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container size="sm" py="xl" className="dp-page">
      <Stack gap="xl">
        <div><Title order={1}>Profile</Title><Text c="dimmed" mt="xs">Your Digital Award account details.</Text></div>
        <Card className="dp-form-shell" p="lg">
          <Stack gap="lg">
            <Group>
              <Avatar size={64} radius="xl" src={user?.avatar}>{user?.name?.charAt(0)}</Avatar>
              <div><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{user?.email || user?.name}</Text><Badge variant="light" mt={6}>{user?.role}</Badge></div>
            </Group>
            <form onSubmit={form.onSubmit(save)}>
              <Stack>
                <TextInput label="Full name" required {...form.getInputProps('name')} />
                <TextInput label="Email" value={user?.email ?? ''} readOnly  />
                <Button type="submit" loading={saving} className="dp-primary-button" w="fit-content">Save changes</Button>
              </Stack>
            </form>
          </Stack>
        </Card>
      </Stack>
    </Container>
  )
}
