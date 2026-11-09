import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  IconArrowUpRight,
  IconMenu2,
  IconX,
} from '@tabler/icons-react'
import { Avatar, Group, Menu, Text, UnstyledButton } from '@mantine/core'
import { useAuthStore } from '../store/authStore'
import { useLanguage } from '../contexts/LanguageContext'
import { useAwardAccess } from '../hooks/useAwardAccess'
import { useNominationEligibility } from '../hooks/useNominationEligibility'
import { useNominationType } from '../hooks/useNominationType'
import { Link, useLocation } from 'react-router-dom'
import { AwardBrand } from '../components/Layout/AwardBrand'
import { useTechBackground } from '../hooks/useTechBackground'
import './LandingPage.css'

const landingVideoSrc = '/media/tech-blue-loop.mp4'
const landingPosterSrc = '/media/tech-blue-poster.jpg'

export function LandingPage({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuthStore()
  const { language, t } = useLanguage()
  const { canReview, canManage } = useAwardAccess()
  const nominationEligibility = useNominationEligibility()
  const [nominationType] = useNominationType()
  const { pathname, hash } = useLocation()
  const showHero = pathname === '/' || pathname === '/overview'
  const [menuOpen, setMenuOpen] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const entryPoints = [
    { label: t('sidebar.overview'), to: '/#overview', active: showHero },
    { label: t('sidebar.nomination'), to: `/nominate?type=${nominationType}`, active: pathname === '/nominate' },
    { label: t('sidebar.projectOverview'), to: '/projects', active: pathname === '/projects' },
  ]

  useEffect(() => {
    if (hash === '#overview' || pathname === '/overview') {
      document.getElementById('overview')?.scrollIntoView({ behavior: 'instant' })
    } else {
      window.scrollTo(0, 0)
    }
    setMenuOpen(false)
  }, [pathname, hash])

  useTechBackground(backdropRef, videoRef)

  useEffect(() => {
    if (!menuOpen) return undefined

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div className="award-landing" id="landing-top">
      <div ref={backdropRef} className="award-landing__backdrop" aria-hidden="true">
        <video
          ref={videoRef}
          className={videoReady ? 'is-ready' : undefined}
          muted
          loop
          playsInline
          preload="auto"
          poster={landingPosterSrc}
          onLoadedData={() => setVideoReady(true)}
          onCanPlay={() => setVideoReady(true)}
          onPlaying={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
        >
          <source src={landingVideoSrc} type="video/mp4" />
        </video>
      </div>

      <header className="award-landing__header">
        <AwardBrand inverse />

        <nav className="award-landing__nav" aria-label="Main navigation">
          {entryPoints.map((item) => (
            <Link
              className={item.active ? 'award-landing__nav-link is-active' : 'award-landing__nav-link'}
              to={item.to}
              aria-current={item.active ? 'page' : undefined}
              key={item.label}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Group className="award-landing__account" gap="sm" wrap="nowrap">
          {user && <Menu shadow="md" zIndex={350} width={220}>
            <Menu.Target>
              <UnstyledButton aria-label={user.email || user.name}>
                <Group gap="sm" wrap="nowrap">
                  <Avatar src={user.avatar} size="sm" radius="xl" />
                  <Text className="dp-header-user-copy" size="sm" fw={500}>{user.email || user.name}</Text>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} to="/my-nominations">My nominations</Menu.Item>
              {nominationEligibility.data?.canReview && <Menu.Item component={Link} to="/nomination-approvals">HoD approvals</Menu.Item>}
              {canReview && <Menu.Item component={Link} to="/awards">{canManage ? (language === 'zh' ? '评选管理' : 'Award management') : (language === 'zh' ? '组委会评分' : 'Committee scoring')}</Menu.Item>}
              {user.role === 'admin' && <Menu.Item component={Link} to="/admin/nominees">{language === 'zh' ? '提名管理' : 'Manage nominees'}</Menu.Item>}
              {canManage && <Menu.Item component={Link} to="/admin/users">{t('sidebar.manageUsers')}</Menu.Item>}
              <Menu.Item component={Link} to="/projects?view=voting-records">My voting records</Menu.Item>
              <Menu.Item component={Link} to="/profile">{t('header.profile')}</Menu.Item>
              <Menu.Item color="red" onClick={() => void logout()}>{t('header.logout')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>}
        </Group>

        <button
          className="award-landing__menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="award-mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
        </button>
      </header>

      {menuOpen ? (
        <>
          <button
            className="award-landing__menu-scrim"
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="award-landing__mobile-menu" id="award-mobile-menu" aria-label="Mobile navigation">
            {entryPoints.map((item) => (
              <Link to={item.to} key={item.label} onClick={() => setMenuOpen(false)}>
                {item.label}
                <IconArrowUpRight aria-hidden="true" size={17} />
              </Link>
            ))}

          </nav>
        </>
      ) : null}

      {showHero && <section className="award-landing__hero">
        <h1 className="award-landing__headline">
          <span>2026 BDCN</span>
          <span>Digital Pioneer Award</span>
        </h1>

        <p className="award-landing__subhead award-landing__reveal" style={{ '--delay': '360ms' } as CSSProperties}>
          Recognize people who turn customer insight, bold ideas, and shared effort into meaningful progress and business values.
        </p>

        <Link
          className="award-landing__cta award-landing__reveal"
          style={{ '--delay': '470ms' } as CSSProperties}
          to="/#overview"
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            document.getElementById('overview')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            })
          }}
        >
          <span>Get Started</span>
        </Link>
      </section>}

      <main id={showHero ? 'overview' : 'award-content'} className="award-landing__content">
        {children}
      </main>

    </div>
  )
}
