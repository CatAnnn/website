export type NominationType = 'individual' | 'team'

export interface DigitalPioneerStandard {
  title?: string
  text: string
  emphasis: readonly string[]
}

export interface DigitalPioneerTrack {
  value: string
  label: string
  labelZh: string
  shorthand: string
  description: string
  standards: readonly DigitalPioneerStandard[]
}

export const DIGITAL_PIONEER_TRACKS: readonly DigitalPioneerTrack[] = [
  {
    value: "Customer Values",
    label: "Customer Values",
    labelZh: "客户价值",
    shorthand: "VALUE",
    description: "Turn deep customer understanding into tangible, lasting value.",
    standards: [
      { title: "Customer Impact (40%)", text: "Delivered measurable value to customers in 2026: adoption/usage growth, efficiency gains, cost reduction or revenue enablement. Results are quantified and verifiable.", emphasis: [] },
      { title: "Deep Customer Insight (30%)", text: "Listened actively and thought from customer perspectives; went beyond stated requirements to uncover hidden needs and pain points; translated insights into product/service improvements.", emphasis: [] },
      { title: "Growing Together With Customers (30%)", text: "Built trust and long-term partnership; grew customer capabilities (enablement, training, co-creation); turned a one-off delivery into sustained business collaboration.", emphasis: [] },
    ],
  },
  {
    value: "Innovation Breakthrough",
    label: "Innovation Breakthrough",
    labelZh: "创新破局",
    shorthand: "SHIFT",
    description: "Challenge the status quo, test boldly, and prove innovation through impact.",
    standards: [
      { title: "Validated Business Value (40%)", text: "Rapid validation and fast iteration (e.g., PoC, pilot); value of the innovation is proven with measurable business results — not just a concept or demo.", emphasis: [] },
      { title: "Innovation Mindset (30%)", text: "Challenged the status quo and proactively asked “Is there a further simplified way?”; Introduced new technologies, methods or cross-disciplinary approaches; the solution is a clear departure from existing processes/solutions.", emphasis: [] },
      { title: "Courage & Ownership (30%)", text: "Voluntarily took on tough tasks and calculated risks; committed to stretch goals; stayed resilient when facing setbacks and honored commitments on quality, cost and delivery.", emphasis: [] },
    ],
  },
  {
    value: "Collaboration to Win",
    label: "Collaboration To Win",
    labelZh: "协作共赢",
    shorthand: "UNITE",
    description: "Break boundaries, share ownership, and turn collective effort into shared success.",
    standards: [
      { title: "Breaking Down Silos (30%)", text: "When the project hit a bottleneck, immediately aligned relevant stakeholders and proactively shared information and resources across team boundaries to seek the best solution.", emphasis: [] },
      { title: "Shared-Goal Ownership (35%)", text: "Took ownership of shared goals beyond own KPI; aligned stakeholders and made decisions quickly (living “Discuss – Decide – Do”) instead of waiting or escalating.", emphasis: [] },
      { title: "Promoting Joint Success (35%)", text: "Proactively supported upstream and downstream tasks while completing own work; Promoted and appreciated joint success; measurably improved the climate of cooperation.", emphasis: [] },
    ],
  },
] as const

export const DIGITAL_PIONEER_TEAM_TRACKS: readonly DigitalPioneerTrack[] = [
  {
    value: "Customer Values",
    label: "Customer Values",
    labelZh: "客户价值",
    shorthand: "VALUE",
    description: "Turn deep customer understanding into tangible, lasting value.",
    standards: [
      { title: "Customer Impact (40%)", text: "Team-level, quantified customer outcomes in 2026 (adoption/usage growth, efficiency gains, cost reduction or revenue enablement. ); impact beyond what individual contributions alone could achieve.", emphasis: [] },
      { title: "Deep Customer Insight (30%)", text: "Team systematically captured user feedback and data; uncovered and prioritized hidden needs/pain points; insight demonstrably shaped the backlog or solution design.", emphasis: [] },
      { title: "Customer Partnership & Growth (30%)", text: "Co-created with customers/users (joint workshops, pilots, shared roadmap); measurably grew customer capabilities and business; established a repeatable partnership model.", emphasis: [] },
    ],
  },
  {
    value: "Innovation Breakthrough",
    label: "Innovation Breakthrough",
    labelZh: "创新破局",
    shorthand: "SHIFT",
    description: "Challenge the status quo, test boldly, and prove innovation through impact.",
    standards: [
      { title: "Validated Business Value (40%)", text: "Innovation validated through rapid pilots and iterations; quantified business results (efficiency, cost, revenue, risk reduction...)", emphasis: [] },
      { title: "Level Of Innovation (30%)", text: "The innovation delivered a clear breakthrough against the status quo: step-change in speed, cost, quality or capability; the team can articulate “before vs. after” convincingly.", emphasis: [] },
      { title: "Courage & Ownership (30%)", text: "The team took on a genuinely tough challenge, iterated through failures, and still honored commitments on quality, cost and delivery.", emphasis: [] },
    ],
  },
  {
    value: "Collaboration to Win",
    label: "Collaboration To Win",
    labelZh: "协作共赢",
    shorthand: "UNITE",
    description: "Break boundaries, share ownership, and turn collective effort into shared success.",
    standards: [
      { title: "Cross-Functional Synergy (30%)", text: "The team demonstrated Discuss–Decide–Do at scale: resolved bottlenecks through fast stakeholder alignment; broke down silos with other departments.", emphasis: [] },
      { title: "Shared Goals & Decision Speed (35%)", text: "The team operated on shared goals with clear, fast decision-making; minimal ping-pong or blame-shifting at interfaces; commitments were reliably met.", emphasis: [] },
      { title: "Win-As-A-Team Culture (35%)", text: "Systematic support to upstream/downstream partners and peer teams.\nVisible promotion and appreciation of joint success; joint wins are celebrated.", emphasis: [] },
    ],
  },
] as const

export function getDigitalPioneerTracks(type: NominationType): readonly DigitalPioneerTrack[] {
  return type === 'team' ? DIGITAL_PIONEER_TEAM_TRACKS : DIGITAL_PIONEER_TRACKS
}

export const DIGITAL_PIONEER_TIMELINE = [
  { phase: 'Self-Nomination', detail: 'Submit your individual nomination', period: 'Nov.16-28' },
  { phase: 'Associate Voting', detail: 'Ten shortlisted nominees per category', period: 'Nov.30-Dec.11' },
  { phase: 'Committee Voting', detail: 'Five finalists per category', period: 'Dec.14-25' },
  { phase: 'Award Announce & Ceremony', detail: 'Winners announced at Townhall', period: 'Jan.' },
] as const

export const DIGITAL_PIONEER_RUBRIC = [
  {
    key: 'behavior',
    name: 'Behavior Demonstration',
    nameZh: '行为示范',
    weight: 70,
    description: 'How clearly the nominee’s actions demonstrate the selected award criteria.',
    levels: [
      { range: '9–10', label: 'Benchmark', detail: 'Perfect alignment; breakthrough action beyond core duties that fills gaps or leads transformation.' },
      { range: '7–8', label: 'Strong', detail: 'Meets the fundamental requirements and performs strongly within the defined scope.' },
      { range: '5–6', label: 'Marginal', detail: 'Descriptions are vague, lack concrete action, or have weak relevance to the award purpose.' },
      { range: '≤ 4', label: 'Non-compliant', detail: 'Low relevance or only routine daily tasks are described.' },
    ],
  },
  {
    key: 'impact',
    name: 'Business Impact',
    nameZh: '业务影响',
    weight: 30,
    description: 'The scale, evidence, and durability of the outcome created.',
    levels: [
      { range: '9–10', label: 'Significant', detail: 'Quantifiable benefits such as cost reduction, revenue growth, efficiency gains, or resolution of chronic issues.' },
      { range: '7–8', label: 'Noticeable', detail: 'Objectives were achieved with visible positive impact on the team or customer.' },
      { range: '5–6', label: 'Marginal', detail: 'Outcomes have limited value or are difficult to verify.' },
      { range: '≤ 4', label: 'Limited', detail: 'No substantive outcome or insufficient evidence in the nomination materials.' },
    ],
  },
] as const

export const DIGITAL_PIONEER_RECOMMENDATIONS = [
  { value: 'Strongly Recommended', label: 'Strongly recommended', description: 'Highly exemplary and a definitive award-winner candidate.' },
  { value: 'Recommend', label: 'Recommend', description: 'Outstanding performance that fully meets the award criteria.' },
  { value: 'Pending', label: 'Pending', description: 'Decision deferred while comparing with other candidates.' },
  { value: 'Not Recommended', label: 'Not recommended', description: 'Does not meet the established standards.' },
] as const

export const DIGITAL_PIONEER_VOTING_RULES = {
  votesPerTrack: 4,
  minimumOutsideDepartment: 2,
  shortlistPerTrack: 10,
  finalistPerTrack: 5,
} as const

export function normalizeDigitalPioneerTrack(category: string, technologies: string[]): string {
  const raw = category.trim()
  const official = DIGITAL_PIONEER_TRACKS.find((track) => track.value.toLowerCase() === raw.toLowerCase())
  if (official) return official.value

  const legacyTracks: Record<string, string> = {
    'AI & Intelligence': DIGITAL_PIONEER_TRACKS[1].value,
    'Digital Transformation': DIGITAL_PIONEER_TRACKS[0].value,
    'Green & Sustainability': DIGITAL_PIONEER_TRACKS[2].value,
  }
  if (legacyTracks[raw]) return legacyTracks[raw]

  const searchable = `${raw} ${technologies.join(' ')}`.toLowerCase()
  if (/collaborat|team|shared|cross.?department|together|silo/.test(searchable)) {
    return DIGITAL_PIONEER_TRACKS[2].value
  }
  if (/customer|client|user|experience|service|process|value/.test(searchable)) {
    return DIGITAL_PIONEER_TRACKS[0].value
  }
  return DIGITAL_PIONEER_TRACKS[1].value
}
