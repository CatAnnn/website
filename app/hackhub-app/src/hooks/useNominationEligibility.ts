import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/apiClient'
import { useAuthStore } from '../store/authStore'

interface NominationEligibility {
  canSubmit: boolean
  canReview: boolean
  nominatingHead: string | null
  message: string | null
}

export function useNominationEligibility() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['nomination-eligibility', user?.id],
    queryFn: () => api.get<NominationEligibility>('/api/v1/me/nomination-eligibility'),
    enabled: Boolean(user),
    staleTime: 0,
    retry: false,
  })
}
