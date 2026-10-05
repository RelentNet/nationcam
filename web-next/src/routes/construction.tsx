import { createFileRoute } from '@tanstack/react-router'
import {
  ConstructionHero,
  FreeCameraStrip,
  IncludedSection,
} from '@/components/construction/ConstructionIntro'
import QuoteBuilder from '@/components/construction/QuoteBuilder'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/construction')({
  head: () =>
    seo({
      title: 'Construction Cameras | NationCam',
      description:
        'Build a quote for job-site cameras: pick a plan, buy or rent a camera or bring your own, choose internet and add-ons, and see a running estimate.',
      path: '/construction',
    }),
  component: ConstructionPage,
})

function ConstructionPage() {
  return (
    <div className="page-container !mt-6">
      <FreeCameraStrip />
      <div className="mt-12 space-y-20">
        <ConstructionHero />
        <IncludedSection />
        <QuoteBuilder />
      </div>
    </div>
  )
}
