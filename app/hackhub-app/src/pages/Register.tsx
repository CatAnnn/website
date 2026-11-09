import { AwardBrand } from '../components/Layout/AwardBrand'
import { useState } from 'react'
import {
  Paper,
  TextInput,
  PasswordInput,
  Button,
  Title,
  Text,
  Anchor,
  Container,
  Center,
  Stack,
  ActionIcon,
  UnstyledButton,
  useMantineColorScheme,
  rem,
} from '@mantine/core'
import { IconSun, IconMoon } from '@tabler/icons-react'
import { useForm } from '@mantine/form'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { notifications } from '@mantine/notifications'
import { useLanguage } from '../contexts/LanguageContext'

interface RegisterFormData {
  name: string
  email: string
  password: string
  confirmPassword: string
}

export function Register() {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const { signup } = useAuthStore()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const { language, toggleLanguage } = useLanguage()

  const form = useForm<RegisterFormData>({
    initialValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    validate: {
      name: (value) => (value.length < 2 ? 'Name must be at least 2 characters' : null),
      email: (value) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value) => (value.length < 6 ? 'Password must be at least 6 characters' : null),
      confirmPassword: (value, values) =>
        value !== values.password ? 'Passwords did not match' : null,
    },
  })

  const handleSubmit = async (values: RegisterFormData) => {
    setSubmitting(true)
    try {
      await signup(values.email, values.password, values.name)
      notifications.show({ title: 'Account created', message: 'Welcome to Digital Award.', color: 'green' })
      navigate('/')
    } catch (error) {
      notifications.show({ title: 'Registration failed', message: error instanceof Error ? error.message : 'Please try again.', color: 'red' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container size={420} my={40}>
      <UnstyledButton
        onClick={toggleLanguage}
        aria-label={language === 'zh' ? '切换到英文' : 'Switch to Chinese'}
        style={{ position: 'fixed', top: rem(20), right: rem(56) }}
      >
        <Text size="sm" fw={500} c="blue">
          {language === 'zh' ? '中' : 'EN'}
        </Text>
      </UnstyledButton>

      <ActionIcon
        variant="subtle"
        size="lg"
        onClick={toggleColorScheme}
        title="Toggle colour scheme"
        style={{ position: 'fixed', top: rem(16), right: rem(16) }}
      >
        {colorScheme === 'dark'
          ? <IconSun style={{ width: rem(20), height: rem(20) }} />
          : <IconMoon style={{ width: rem(20), height: rem(20) }} />}
      </ActionIcon>

      <Center mb={30}>
        <Stack align="center" gap="xs">
          <AwardBrand />
        </Stack>
      </Center>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        <Title ta="center" order={2} mb="md">
          Create Your Account
        </Title>
        
        <Text c="dimmed" size="sm" ta="center" mt={5} mb="xl">
          Create your account to join the Digital Pioneer Award
        </Text>

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Full Name"
              placeholder="John Doe"
              required
              {...form.getInputProps('name')}
            />

            <TextInput
              label="Email"
              placeholder="your@email.com"
              required
              {...form.getInputProps('email')}
            />

            <PasswordInput
              label="Password"
              placeholder="Your password"
              required
              {...form.getInputProps('password')}
            />

            <PasswordInput
              label="Confirm Password"
              placeholder="Confirm your password"
              required
              {...form.getInputProps('confirmPassword')}
            />

            <Button type="submit" loading={submitting} fullWidth mt="xl" size="md">
              Create Account
            </Button>
          </Stack>
        </form>

        <Text c="dimmed" size="sm" ta="center" mt={20}>
          Already have an account?{' '}
          <Anchor size="sm" component={Link} to="/login">
            Sign in
          </Anchor>
        </Text>
      </Paper>
    </Container>
  )
}
