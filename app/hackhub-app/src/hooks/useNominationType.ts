import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { NominationType } from '../config/digitalPioneer'

const storageKey = 'award-nomination-type'

export function useNominationType(): readonly [NominationType, (type: NominationType) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const requested = new URLSearchParams(location.search).get('type')
  let remembered: string | null = null
  try { remembered = sessionStorage.getItem(storageKey) } catch { /* URL remains usable without storage. */ }
  const type: NominationType = requested === 'individual' || requested === 'team'
    ? requested : remembered === 'team' ? 'team' : 'individual'

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, type) } catch { /* Preference is optional. */ }
  }, [type])

  const select = (next: NominationType) => {
    const params = new URLSearchParams(location.search)
    params.set('type', next)
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true, preventScrollReset: true })
  }
  return [type, select]
}
