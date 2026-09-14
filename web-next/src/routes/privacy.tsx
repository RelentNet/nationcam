import { Link, createFileRoute } from '@tanstack/react-router'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/privacy')({
  head: () =>
    seo({
      title: 'Privacy Policy | NationCam',
      description:
        'How NationCam collects, uses, and protects information when you watch our live cameras, contact us, or apply to host a camera.',
      path: '/privacy',
    }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <div className="page-container">
      <article className="mx-auto max-w-3xl">
        <p className="font-mono text-xs text-subtext0">
          Last updated: September 14, 2026
        </p>
        <h1>Privacy Policy</h1>
        <p>
          This Privacy Policy explains what information NationCam
          (&ldquo;NationCam,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects
          when you use nationcam.com (the &ldquo;Site&rdquo;), how we use it,
          and the choices you have. By using the Site you agree to the practices
          described here.
        </p>

        <h2>Information we collect</h2>
        <p>
          <strong>Information you give us.</strong> When you contact us or apply
          to host a camera, we collect what you submit in the form: your name,
          email address, and — for camera-hosting applications — the number of
          cameras, whether you have internet access at the location, the
          address of the location, and your timeline. We use this to review your
          request and reply to you.
        </p>
        <p>
          <strong>Account information.</strong> Camera hosts and administrators
          who sign in to manage cameras do so through our authentication
          provider, Logto. We receive the basic profile information associated
          with that account (such as a name and email address) in order to
          identify you and control access.
        </p>
        <p>
          <strong>Usage and device information.</strong> Like most websites, we
          automatically receive technical information when you visit, such as
          your IP address, browser type, device type, pages viewed, referring
          page, and the date and time of your visit. Our servers also keep
          standard access logs for security and troubleshooting.
        </p>
        <p>
          <strong>Cookies and local storage.</strong> We use cookies and similar
          browser storage to remember your preferences (for example, your
          light/dark theme), to limit how often you see the same advertisement,
          and to keep you signed in if you have an account. Third parties
          described below also set cookies.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>To operate the Site and stream live camera feeds.</li>
          <li>To review and respond to contact and camera-hosting requests.</li>
          <li>To understand how the Site is used so we can improve it.</li>
          <li>To show and measure advertising that helps keep the Site free.</li>
          <li>To secure the Site, prevent abuse, and comply with the law.</li>
        </ul>

        <h2>Advertising</h2>
        <p>
          We use Google AdSense and other third-party advertising vendors to
          display ads on the Site. Third-party vendors, including Google, use
          cookies to serve ads based on your prior visits to this Site and to
          other websites. Google&rsquo;s use of advertising cookies enables it
          and its partners to serve ads to you based on your visit to this Site
          and/or other sites on the internet.
        </p>
        <p>
          You may opt out of personalized advertising by visiting{' '}
          <a
            href="https://www.google.com/settings/ads"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Google Ads Settings
          </a>
          . You can also opt out of some third-party vendors&rsquo; use of
          cookies for personalized advertising at{' '}
          <a
            href="https://www.aboutads.info/choices/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            aboutads.info
          </a>
          . We also run our own house and partner advertisements; when we do, we
          count views and clicks of those ads in aggregate.
        </p>

        <h2>Analytics</h2>
        <p>
          We use PostHog to understand how visitors use the Site — for example,
          which pages and cameras are popular and how people navigate. PostHog
          collects usage and device information as described above. We do not
          use analytics to identify you personally.
        </p>

        <h2>Live video and third-party services</h2>
        <p>
          Camera feeds are provided by the businesses and individuals who host
          each camera and are delivered through our streaming infrastructure.
          Cameras point at public-facing views such as marinas, waterfronts, and
          streetscapes; we do not host cameras in private areas. Some pages may
          include optional audio streams provided by third-party radio
          services. When you play a stream, the streaming service receives your
          IP address in order to deliver the video to you.
        </p>

        <h2>How we share information</h2>
        <p>
          We do not sell your personal information. We share information only
          with the service providers that help us run the Site (hosting,
          authentication, analytics, and advertising partners described above),
          when required by law or to protect our rights and users, or with your
          consent. If NationCam is involved in a merger, acquisition, or sale of
          assets, information may be transferred as part of that transaction.
        </p>

        <h2>Data retention</h2>
        <p>
          We keep contact and camera-hosting submissions for as long as needed
          to respond to and act on them. Server logs are kept for a limited
          period for security purposes. Analytics data is retained according to
          our analytics provider&rsquo;s settings. You may ask us to delete
          information you have submitted at any time.
        </p>

        <h2>Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect the
          information we hold, including encrypted connections (HTTPS) and
          access controls on administrative tools. No method of transmission or
          storage is completely secure, and we cannot guarantee absolute
          security.
        </p>

        <h2>Children</h2>
        <p>
          The Site is intended for a general audience and is not directed at
          children under 13. We do not knowingly collect personal information
          from children under 13. If you believe a child has provided us
          information, please contact us and we will delete it.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>
            You can control cookies through your browser settings; disabling
            them may affect some features.
          </li>
          <li>
            You can opt out of personalized advertising using the links in the
            Advertising section above.
          </li>
          <li>
            You can request access to, correction of, or deletion of information
            you have submitted by contacting us.
          </li>
        </ul>

        <h2>Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we
          will revise the &ldquo;Last updated&rdquo; date above. Continued use
          of the Site after changes take effect means you accept the revised
          policy.
        </p>

        <h2>Contact us</h2>
        <p>
          Questions about this policy or your information? Reach us through our{' '}
          <Link to="/contact" className="text-accent hover:underline">
            contact page
          </Link>
          .
        </p>
      </article>
    </div>
  )
}
