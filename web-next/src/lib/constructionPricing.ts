/**
 * Construction quote builder: every price, option and piece of copy that
 * depends on a price lives here, so the components hold no numbers. The
 * estimate functions are pure and take a `QuoteConfig`.
 *
 * Camera model numbers are internal and deliberately absent from this file:
 * they must never reach the page or the submitted message.
 */

export type PlanId = 'essential' | 'pro' | 'premium'
export type Acquisition = 'buy' | 'rent' | 'own'
export type StyleId = 'fixed' | 'panoramic' | 'ptz' | 'ultra'
export type InternetId = 'nationcam' | 'customer'

export interface QuoteConfig {
  plan: PlanId
  acquisition: Acquisition
  style: StyleId
  /** Id of a resolution that belongs to `style`. */
  resolution: string
  internet: InternetId
  foreverVideo: boolean
  weatherStation: boolean
  cameras: number
}

export const MIN_CAMERAS = 1
export const MAX_CAMERAS = 20

export interface Plan {
  id: PlanId
  name: string
  /** Per camera, per month. */
  monthly: number
  lead: string | null
  features: Array<string>
}

export const plans: Array<Plan> = [
  {
    id: 'essential',
    name: 'Essential',
    monthly: 79,
    lead: null,
    features: [
      'Private live view and command center',
      'Unlimited team users',
      'Site conditions: weather, satellite-detected lightning, NWS alerts',
      'Time-lapse photo every 15 minutes',
      '7 days of recorded video',
      'Photos kept 1 year after the project',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 229,
    lead: 'Everything in Essential, plus:',
    features: [
      'Time-lapse photo every minute',
      '30 days of recorded video',
      'Photos kept 3 years',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    monthly: 349,
    lead: 'Everything in Pro, plus:',
    features: [
      '90 days of recorded video',
      'Photos kept permanently',
      'On-site weather station service included',
      'Edited time-lapse film at project end',
    ],
  },
]

export interface AcquisitionOption {
  id: Acquisition
  title: string
  text: string
}

export const acquisitions: Array<AcquisitionOption> = [
  {
    id: 'rent',
    title: 'Rent',
    text: 'Pay monthly. If the camera fails, we swap it.',
  },
  {
    id: 'buy',
    title: 'Buy',
    text: 'You own the hardware.',
  },
  {
    id: 'own',
    title: 'Bring your own',
    text: 'Use a camera you already have. It needs a standard RTSP video stream; we check compatibility with you.',
  },
]

export interface Resolution {
  id: string
  label: string
  buy: number
  /** Per camera, per month. */
  rent: number
}

export interface CameraStyle {
  id: StyleId
  title: string
  sees: string
  bestFor: string
  goodToKnow: string
  /** Lowest first; the first one is the style's default. */
  resolutions: Array<Resolution>
}

export const styles: Array<CameraStyle> = [
  {
    id: 'fixed',
    title: 'Fixed',
    sees: 'One fixed view of your site, day and night.',
    bestFor: 'A single elevation, a gate or a laydown yard.',
    goodToKnow:
      'The simplest and lowest-cost option. Higher resolutions need a faster connection to stream at full detail.',
    resolutions: [
      { id: 'fixed-2mp', label: '2 MP (1080p)', buy: 795, rent: 39 },
      { id: 'fixed-4mp', label: '4 MP', buy: 949, rent: 49 },
      { id: 'fixed-8mp', label: '8 MP (4K)', buy: 1795, rent: 95 },
      { id: 'fixed-41mp', label: '41 MP', buy: 7795, rent: 419 },
    ],
  },
  {
    id: 'panoramic',
    title: 'Panoramic 180°',
    sees: 'A 180° view from one camera, stitched into a single image.',
    bestFor: 'Seeing the whole site from one pole or rooftop.',
    goodToKnow: 'One camera replaces several fixed ones.',
    resolutions: [
      { id: 'pano-7mp', label: '7 MP', buy: 2595, rent: 139 },
      { id: 'pano-13mp', label: '13 MP', buy: 3295, rent: 175 },
    ],
  },
  {
    id: 'ptz',
    title: 'PTZ',
    sees: 'Pans, tilts and zooms optically, moving between preset views of the site.',
    bestFor: 'Large sites with several areas to watch.',
    goodToKnow: 'Preset views are set up with you at install.',
    resolutions: [
      { id: 'ptz-2mp', label: '2 MP, 10x zoom', buy: 1695, rent: 89 },
      { id: 'ptz-4mp', label: '4 MP, 30x zoom', buy: 3595, rent: 189 },
      { id: 'ptz-8mp', label: '8 MP (4K), 31x zoom', buy: 5695, rent: 309 },
    ],
  },
  {
    id: 'ultra',
    title: 'Ultra high resolution',
    sees: 'A DSLR or mirrorless camera in a weatherproof housing that sends an ultra high resolution photo of the site every minute.',
    bestFor: 'Marketing-grade time-lapse films and large prints.',
    goodToKnow:
      'Photos only, no video. Pair it with a video camera if you also want live view.',
    resolutions: [{ id: 'ultra-61mp', label: '61 MP', buy: 7995, rent: 429 }],
  },
]

/**
 * The one extra line the summary, "How it works" and the message carry when
 * the picked style is a photo camera rather than a video camera.
 */
export function photoCameraNote(c: QuoteConfig): string | null {
  return c.acquisition !== 'own' && c.style === 'ultra'
    ? 'This camera sends a photo every minute; live view and recorded video need a video camera as well.'
    : null
}

export interface InternetOption {
  id: InternetId
  title: string
  text: string
  /** Per site, per month; charged once whatever the camera count. */
  monthly: number
}

export const internetOptions: Array<InternetOption> = [
  {
    id: 'nationcam',
    title: 'NationCam provides it',
    text: 'Cellular or satellite internet, managed and remotely supported by us. One connection can serve several cameras on the same site.',
    monthly: 60,
  },
  {
    id: 'customer',
    title: 'You provide it',
    text: 'Use your site connection and pay only for the streaming service.',
    monthly: 0,
  },
]

/** Per camera, per month. */
export const FOREVER_VIDEO_MONTHLY = 99
/** Per site, per month (included with Premium). */
export const WEATHER_STATION_MONTHLY = 15
/** Station hardware, one-time, on every plan. */
export const WEATHER_STATION_UPFRONT = 249

export const defaultConfig: QuoteConfig = {
  plan: 'pro',
  acquisition: 'rent',
  style: 'fixed',
  resolution: 'fixed-4mp',
  internet: 'nationcam',
  foreverVideo: false,
  weatherStation: false,
  cameras: 1,
}

/* ──── Lookups ──── */

export function getPlan(id: PlanId): Plan {
  return plans.find((p) => p.id === id) ?? plans[0]
}

export function getStyle(id: StyleId): CameraStyle {
  return styles.find((s) => s.id === id) ?? styles[0]
}

export function getAcquisition(id: Acquisition): AcquisitionOption {
  return acquisitions.find((a) => a.id === id) ?? acquisitions[0]
}

export function getInternet(id: InternetId): InternetOption {
  return internetOptions.find((i) => i.id === id) ?? internetOptions[0]
}

/** The chosen resolution, falling back to the style's lowest one. */
export function getResolution(style: StyleId, id: string): Resolution {
  const s = getStyle(style)
  return s.resolutions.find((r) => r.id === id) ?? s.resolutions[0]
}

/** The style's lowest buy or rent price, for its "from" line. */
export function styleFromPrice(style: StyleId, mode: 'buy' | 'rent'): number {
  return Math.min(...getStyle(style).resolutions.map((r) => r[mode]))
}

/** The lowest plan, rent and buy prices across the catalogue, for the hero. */
export function lowestPrices(): { plan: number; rent: number; buy: number } {
  const all = styles.flatMap((s) => s.resolutions)
  return {
    plan: Math.min(...plans.map((p) => p.monthly)),
    rent: Math.min(...all.map((r) => r.rent)),
    buy: Math.min(...all.map((r) => r.buy)),
  }
}

export function clampCameras(n: number): number {
  if (!Number.isFinite(n)) return MIN_CAMERAS
  return Math.min(MAX_CAMERAS, Math.max(MIN_CAMERAS, Math.round(n)))
}

export function weatherStationMonthly(plan: PlanId): number {
  return plan === 'premium' ? 0 : WEATHER_STATION_MONTHLY
}

/* ──── Estimate ──── */

export function estimateMonthly(c: QuoteConfig): number {
  const cameras = clampCameras(c.cameras)
  const camera =
    c.acquisition === 'rent'
      ? cameras * getResolution(c.style, c.resolution).rent
      : 0
  return (
    cameras * getPlan(c.plan).monthly +
    camera +
    getInternet(c.internet).monthly +
    (c.foreverVideo ? cameras * FOREVER_VIDEO_MONTHLY : 0) +
    (c.weatherStation ? weatherStationMonthly(c.plan) : 0)
  )
}

export function estimateUpfront(c: QuoteConfig): number {
  const cameras = clampCameras(c.cameras)
  const camera =
    c.acquisition === 'buy'
      ? cameras * getResolution(c.style, c.resolution).buy
      : 0
  return camera + (c.weatherStation ? WEATHER_STATION_UPFRONT : 0)
}

export function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/* ──── Plain-words description ──── */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export interface SummaryLine {
  label: string
  value: string
}

/** Every pick in plain words: the summary panel and the submitted message. */
export function describeConfig(c: QuoteConfig): Array<SummaryLine> {
  const cameras = clampCameras(c.cameras)
  const plan = getPlan(c.plan)
  const lines: Array<SummaryLine> = [
    {
      label: 'Plan',
      value: `${plan.name}, from ${formatUSD(plan.monthly)} per camera / month`,
    },
    { label: 'Number of cameras', value: String(cameras) },
  ]

  if (c.acquisition === 'own') {
    lines.push({
      label: 'Camera',
      value: 'Bring your own (standard RTSP video stream)',
    })
  } else {
    const res = getResolution(c.style, c.resolution)
    const buy = c.acquisition === 'buy'
    lines.push(
      { label: 'Camera', value: buy ? 'Buy' : 'Rent' },
      { label: 'Style', value: getStyle(c.style).title },
      {
        label: 'Resolution',
        value: `${res.label}, ${
          buy
            ? `buy from ${formatUSD(res.buy)} each`
            : `rent from ${formatUSD(res.rent)} / month each`
        }`,
      },
    )
  }

  const internet = getInternet(c.internet)
  lines.push({
    label: 'Internet',
    value:
      internet.monthly > 0
        ? `${internet.title}, from ${formatUSD(internet.monthly)} / month per site`
        : `${internet.title}, no internet charge`,
  })

  const addOns: Array<string> = []
  if (c.foreverVideo) {
    addOns.push(
      `Forever video (+${formatUSD(FOREVER_VIDEO_MONTHLY)} per camera / month)`,
    )
  }
  if (c.weatherStation) {
    addOns.push(
      c.plan === 'premium'
        ? `On-site weather station (service included with Premium; station ${formatUSD(WEATHER_STATION_UPFRONT)} one-time)`
        : `On-site weather station (+${formatUSD(WEATHER_STATION_MONTHLY)} / month per site; station ${formatUSD(WEATHER_STATION_UPFRONT)} one-time)`,
    )
  }
  lines.push({
    label: 'Add-ons',
    value: addOns.length > 0 ? addOns.join('; ') : 'None',
  })

  const note = photoCameraNote(c)
  if (note) lines.push({ label: 'Note', value: note })

  return lines
}

/* ──── How it works, written from the picks ──── */

export interface HowStep {
  title: string
  text: string
}

export function howItWorks(c: QuoteConfig): Array<HowStep> {
  const n = clampCameras(c.cameras)
  const cam = plural(n, 'camera', 'cameras')
  const theCam = plural(n, 'the camera', 'each camera')
  const providesInternet = c.internet === 'nationcam'
  const ownNetwork = `${n === 1 ? 'It plugs' : 'They plug'} into your site network and ${plural(n, 'needs', 'need')} an outbound internet connection.`

  const steps: Array<HowStep> = [
    {
      title: 'We confirm your quote',
      text: 'We go through your picks and your site details with you on a call, and confirm the price.',
    },
  ]

  if (c.acquisition === 'own') {
    steps.push(
      {
        title: 'Tell us about your camera',
        text: `Send us the make and model of your ${cam}. We check that ${n === 1 ? 'it offers' : 'they offer'} a standard RTSP video stream.`,
      },
      {
        title: 'We connect the stream',
        text: providesInternet
          ? `We ship a managed router for your site, ${theCam} plugs into it, and we connect ${n === 1 ? 'its stream' : 'their streams'}.`
          : `We connect ${n === 1 ? 'its stream' : 'their streams'} to NationCam. ${ownNetwork}`,
      },
    )
  } else {
    steps.push(
      {
        title: 'We prepare your camera kit',
        text: providesInternet
          ? `We set up your ${cam} and ship the kit, with a managed router for your site connection.`
          : `We set up your ${cam} and ship the kit to you.`,
      },
      {
        title: 'Power and mounting',
        text: `${n === 1 ? 'The camera needs' : 'Each camera needs'} power at the mounting spot. Depending on where your site is, we install ${n === 1 ? 'it' : 'them'}, or you do with our help.${providesInternet ? '' : ` ${ownNetwork}`}`,
      },
    )
  }

  steps.push({
    title: `Your ${cam} ${plural(n, 'comes', 'come')} online`,
    text: 'We set up your private account, so you can invite your team to the live view and the command center.',
  })

  if (c.acquisition === 'rent') {
    steps.push({
      title: 'At project end',
      text: `When the project wraps up, the ${cam} ${plural(n, 'comes', 'come')} back to us.`,
    })
  } else if (c.acquisition === 'buy') {
    steps.push({
      title: `The ${cam} ${plural(n, 'is', 'are')} yours`,
      text: `You keep the ${cam}, and your plan can move with ${n === 1 ? 'it' : 'them'} to your next site.`,
    })
  } else {
    steps.push({
      title: 'Stay flexible',
      text: 'Cancel the plan any time.',
    })
  }

  return steps
}
