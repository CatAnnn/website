import { Button, Container, Grid, Group, Stack, Text } from '@mantine/core'
import { IconBallpen, IconEye } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import digitalCubes from '../assets/bosch-digital-cubes.png'
import { AwardCriteriaList } from '../components/AwardCriteriaList'
import { useLanguage } from '../contexts/LanguageContext'
import { DIGITAL_PIONEER_TIMELINE, getDigitalPioneerTracks } from '../config/digitalPioneer'
import { useNominationType } from '../hooks/useNominationType'
import './DigitalPioneer.css'

const copy = {
  en: {
    nominate: 'Start A Nomination',
    browse: 'Browse & Vote',
    categoriesTitle: 'Award Categories And Criteria',
    timelineTitle: '2026 Timeline',
  },
  zh: {
    nominate: '开始报名',
    browse: '浏览并投票',
    categoriesTitle: '奖项赛道与评选标准',
    timelineTitle: '2026 评选时间线',
  },
} as const

export function DigitalPioneerOverview(): ReactElement {
  const { language } = useLanguage()
  const text = copy[language]
  const [nominationType, setNominationType] = useNominationType()

  return (
    <Container size={1440} py={{ base: 'md', md: 'xl' }} className="dp-page">
      <section className="dp-hero dp-overview-hero" aria-labelledby="digital-pioneer-title">
        <Grid className="dp-hero__content" gutter={{ base: 42, lg: 76 }} align="center">
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Stack gap={32}>
              <div>
                <h1 id="digital-pioneer-title" className="dp-hero__title">
                  2026 BDCN Digital Pioneer
                </h1>
                <Text className="dp-hero__intro" mt="xl">The Digital Pioneer Award honors individuals and teams who actively drive digital transformation and live BDCN High-Performance Culture— delivering customer values, pioneering innovation, and achieving shared success through collaboration.</Text>
              </div>
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 5 }}>
            <div className="dp-overview-logo-wrap">
              <img className="dp-overview-logo" src={digitalCubes} alt="Bosch Digital Cubes" width={1254} height={1254} style={{ aspectRatio: '1', objectFit: 'contain' }} />
            </div>
          </Grid.Col>
        </Grid>
      </section>

      <section className="dp-section dp-categories-section" aria-labelledby="award-categories-title">
        <div className="dp-category-heading">
          <h2 id="award-categories-title" className="dp-section-title dp-categories-title" style={{ marginBottom: 0 }}>{text.categoriesTitle}</h2>
          <Button.Group className="dp-type-switch" aria-label="Nomination type">
            {(['individual', 'team'] as const).map((type) => <Button key={type} variant={nominationType === type ? 'filled' : 'outline'} radius="xl" aria-pressed={nominationType === type} onClick={() => setNominationType(type)}>{type === 'individual' ? 'Individual' : 'Team'}</Button>)}
          </Button.Group>
        </div>

        <div className="dp-track-grid">
          {getDigitalPioneerTracks(nominationType).map((track) => (
            <article className="dp-track" key={track.value}>
              <h3 className="dp-track-title" translate="no">
                <span lang="en">{track.label}</span>
                <span className="dp-track-zh" lang="zh">{track.labelZh}</span>
              </h3>
              <AwardCriteriaList standards={track.standards} />
            </article>
          ))}
        </div>
      </section>

      <section className="dp-section" aria-labelledby="campaign-timeline-title">
        <h2 id="campaign-timeline-title" className="dp-section-title">{text.timelineTitle}</h2>
        <div className="dp-timeline">
          {DIGITAL_PIONEER_TIMELINE.map((item, index) => (
            <article className="dp-timeline-item" key={item.phase}>
              <span className="dp-timeline-node" aria-hidden="true" />
              <div className="dp-timeline-card">
                <span className="dp-timeline-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <Text className="dp-timeline-period">{item.period}</Text>
                <h3 className="dp-timeline-phase" translate="no">{item.phase}</h3>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="dp-cta" aria-label={text.nominate}>
        <Group gap="sm" justify="center">
          <Button
            component={Link}
            to={`/nominate?type=${nominationType}`}
            className="dp-primary-button"
            size="lg"
            leftSection={<IconBallpen size={18} />}
          >
            {text.nominate}
          </Button>
          <Button
            component={Link}
            to="/projects"
            variant="default"
            className="dp-secondary-button"
            size="lg"
            leftSection={<IconEye size={18} />}
          >
            {text.browse}
          </Button>
        </Group>
      </section>
    </Container>
  )
}
