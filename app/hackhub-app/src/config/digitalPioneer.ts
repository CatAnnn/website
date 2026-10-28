export interface DigitalPioneerStandard {
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
    value: 'Customer Values',
    label: 'Customer Values',
    labelZh: '客户价值',
    shorthand: 'VALUE',
    description: 'Turn deep customer understanding into tangible, lasting value.',
    standards: [
      {
        text: "Deliver end-to-end solutions and create tangible values for customers/users.",
        emphasis: ["end-to-end solutions", "create tangible values"],
      },
      {
        text: "Win customers/users by delivering differentiated, market-leading products and services, establishing long-term win-win partnerships to co-grow capabilities and business.",
        emphasis: ["differentiated, market-leading products and services"],
      },
      {
        text: "Listen actively to customers/users, think from their perspectives, and uncover hidden needs and pain points.",
        emphasis: ["Listen actively", "think from their perspectives, and uncover hidden needs and pain points."],
      },
      {
        text: "Continuously enhance customer experience and co-create value. Demonstrate service excellence, proactively resolving issues beyond expectations and transforming challenges into opportunities.",
        emphasis: ["enhance customer experience", "transforming challenges into opportunities."],
      },
    ],
  },
  {
    value: 'Innovation Breakthrough',
    label: 'Innovation Breakthrough',
    labelZh: '创新破局',
    shorthand: 'SHIFT',
    description: 'Challenge the status quo, test boldly, and prove innovation through impact.',
    standards: [
      {
        text: "The innovation delivered a clear breakthrough against the status quo, shows the courage to think out of box and willingness to take smart risks.",
        emphasis: ["think out of box"],
      },
      {
        text: "Take a broader view of innovation and embed it along the entire value chain.",
        emphasis: [],
      },
      {
        text: "Never settle for existing processes or solutions, proactively pioneer the adoption of cutting-edge technologies and cross-disciplinary methodologies to explore optimal paths.",
        emphasis: ["explore optimal paths."],
      },
      {
        text: "Foster a culture of \"rapid validation and continuous iteration\", demonstrating the true value of innovation through sustainable business impact.",
        emphasis: ["rapid validation and continuous iteration", "sustainable business impact."],
      },
    ],
  },
  {
    value: 'Collaboration to Win',
    label: 'Collaboration to Win',
    labelZh: '协作共赢',
    shorthand: 'UNITE',
    description: 'Break boundaries, share ownership, and turn collective effort into shared success.',
    standards: [
      {
        text: "Live the \"Discuss – Decide – Do\" principle: when encountering bottlenecks, swiftly align key stakeholders to drive high-quality, decisive actions",
        emphasis: ["Discuss – Decide – Do"],
      },
      {
        text: "Proactively share information and resources across boundaries to eliminate silos and foster synergy, achieving the best solution.",
        emphasis: ["across boundaries", "foster synergy"],
      },
      {
        text: "Took ownership of shared goals, proactively support upstream and downstream tasks while completing their own work.",
        emphasis: ["Took ownership of shared goals"],
      },
      {
        text: "Promote and appreciate joint success, enabling the team to win as one and fostering trust across functions.",
        emphasis: ["win as one"],
      },
    ],
  },
] as const

export const DIGITAL_PIONEER_TIMELINE = [
  { phase: 'Self-nomination', detail: 'Submit your individual nomination', period: 'Nov.16-28' },
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
