import { Link, createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/terms')({
  head: () =>
    seo({
      title: 'Terms of Service | NationCam',
      description:
        'The terms that govern your use of NationCam, our free network of live cameras across the United States, and the responsibilities of camera hosts.',
      path: '/terms',
    }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <div className="page-container">
      <article className="mx-auto max-w-3xl">
        <p className="font-mono text-xs text-subtext0">
          Last updated: September 14, 2026
        </p>
        <h1>Terms of Service</h1>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
          nationcam.com and the live camera feeds, pages, and services we
          provide (together, the &ldquo;Service&rdquo;). By using the Service
          you agree to these Terms. If you do not agree, please do not use the
          Service.
        </p>

        <h2>1. The Service</h2>
        <p>
          NationCam provides free access to live camera feeds from locations
          across the United States, hosted by the businesses and individuals
          who operate each camera. The Service is provided for personal,
          informational, and entertainment use. Camera feeds show live
          conditions and are not monitored in real time by NationCam.
        </p>
        <p>
          Every feed on NationCam is contributed by the business or property
          owner who operates that camera and who has given us permission to
          stream their view. What a camera may show, and your responsibility
          as a viewer, is described in Section 4.
        </p>

        <h2>2. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            Use the Service for any unlawful purpose or to violate the rights
            of others.
          </li>
          <li>
            Use any camera feed to stalk, harass, surveil, or track any person.
          </li>
          <li>
            Copy, record, redistribute, resell, or embed camera feeds or other
            content without our written permission.
          </li>
          <li>
            Interfere with the Service, attempt to gain unauthorized access, or
            place excessive load on our systems (including scraping or
            automated bulk access).
          </li>
          <li>
            Circumvent or block advertising, or use the Service to distribute
            spam or malicious code.
          </li>
        </ul>

        <h2>3. Camera hosts</h2>
        <p>
          If you host a camera on NationCam, you represent that you own or have
          the right to operate the camera at its location and to stream its
          view publicly, that by adding it you give NationCam permission to
          stream that view, and that you have obtained any consents required by
          applicable law. Cameras must point at public-facing areas — such as
          marinas, waterfronts, streetscapes, and public outdoor spaces — and
          must not capture private areas or areas where people have a
          reasonable expectation of privacy.
        </p>
        <p>
          You retain ownership of your camera feed. By hosting it on NationCam
          you grant us a non-exclusive, worldwide, royalty-free license to
          stream, display, store snapshots of, and promote the feed on the
          Service and in materials about the Service. You may end this license
          by asking us to remove your camera, which we will do within a
          reasonable time. We may remove any feed at our discretion, including
          feeds that go offline, violate these Terms, or are otherwise
          unsuitable for the Service.
        </p>

        <h2>4. Camera content and viewer discretion</h2>
        <p>
          Every camera on NationCam shows a public-facing area — a marina, a
          waterfront, a street, a plaza, or another public outdoor space — and
          each one is added by the business or property owner who operates it
          and who has given NationCam permission to stream their view. We do
          not install cameras in private areas, and hosts may not point a
          camera anywhere people have a reasonable expectation of privacy.
        </p>
        <p>
          Feeds are live and unedited. NationCam does not control, curate,
          review, or monitor in real time what passes in front of a camera,
          and we cannot predict it. Because these are public spaces, a feed may
          at any moment show people, vehicles, animals, weather, accidents, or
          behavior that we did not choose and do not endorse. That includes
          public events and celebrations — Mardi Gras, festivals, parades, and
          the like — during which a camera may capture conduct, attire, or
          nudity that some viewers may find objectionable or unsuitable for
          minors.
        </p>
        <p>
          NationCam is not responsible or liable for anything that appears in a
          live feed, and nothing shown on a camera reflects the views of
          NationCam or its hosts. Viewer discretion is advised. If you believe a
          feed is showing content that is unlawful or that violates these
          Terms, please{' '}
          <Link to="/contact" className="text-accent hover:underline">
            contact us
          </Link>
          ; we may suspend or remove a feed at our discretion.
        </p>

        <h2>5. Intellectual property</h2>
        <p>
          The NationCam name, logo, website design, and original content are
          owned by NationCam. Camera feeds are owned by their respective hosts.
          Nothing in these Terms grants you any right to use our trademarks or
          content except as permitted for personal viewing.
        </p>

        <h2>6. Advertising and third parties</h2>
        <p>
          The Service is supported by advertising, which may be provided by
          NationCam or by third-party advertising partners. The Service may also
          link to or include content from third parties, such as advertisers,
          camera hosts, and audio providers. We are not responsible for
          third-party content, products, or services.
        </p>

        <h2>7. Availability and disclaimers</h2>
        <p>
          Live feeds depend on cameras and internet connections that are
          operated by hosts, and on third-party streaming infrastructure. Feeds
          may be interrupted, delayed, offline, or discontinued at any time
          without notice. THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND
          &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
          PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. Do not rely on a
          camera feed as the sole basis for decisions involving safety, weather,
          navigation, or travel. See Section 4 regarding the content that may
          appear in a feed.
        </p>

        <h2>8. Limitation of liability</h2>
        <p>
          TO THE FULLEST EXTENT PERMITTED BY LAW, NATIONCAM AND ITS OWNERS,
          OPERATORS, AND PARTNERS WILL NOT BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS
          OF DATA, PROFITS, OR GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF
          THE SERVICE OR ANY CONTENT SHOWN IN A LIVE FEED. OUR TOTAL LIABILITY
          FOR ANY CLAIM RELATED TO THE SERVICE WILL NOT EXCEED ONE HUNDRED U.S.
          DOLLARS ($100).
        </p>

        <h2>9. Indemnification</h2>
        <p>
          You agree to indemnify and hold NationCam harmless from claims,
          damages, and expenses (including reasonable attorneys&rsquo; fees)
          arising from your violation of these Terms or, if you are a camera
          host, from the feed you provide.
        </p>

        <h2>10. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service, or remove any
          camera, at any time for conduct that violates these Terms or harms
          the Service or other users. You may stop using the Service at any
          time.
        </p>

        <h2>11. Governing law</h2>
        <p>
          These Terms are governed by the laws of the State of Louisiana and
          applicable United States federal law, without regard to conflict of
          law principles. Any dispute arising from these Terms or the Service
          will be brought in the state or federal courts located in Louisiana,
          and you consent to their jurisdiction.
        </p>

        <h2>12. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. When we do, we will
          revise the &ldquo;Last updated&rdquo; date above. Continued use of
          the Service after changes take effect means you accept the revised
          Terms.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these Terms? Reach us through our{' '}
          <Link to="/contact" className="text-accent hover:underline">
            contact page
          </Link>
          .
        </p>
      </article>
    </div>
  )
}
