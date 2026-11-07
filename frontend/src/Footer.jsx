import { useState } from 'react';
import Logo from './Logo';

const GROUPS = [
    {
        title: 'About Repeato',
        links: [
            { label: 'About Us', href: '#about' },
            { label: 'How Repeato Works', href: '#how-it-works' },
            { label: 'Our Loyalty Program', href: '#rewards' },
            { label: 'For Local Businesses', action: 'owner' },
            { label: 'Why Repeato', href: '#about' }
        ]
    },
    {
        title: 'Explore',
        links: [
            { label: 'Discover Rewards', href: '#rewards' },
            { label: 'Earn Points', href: '#how-it-works' },
            { label: 'Redeem Rewards', href: '#rewards' },
            { label: 'QR & NFC Rewards', action: 'customer' },
            { label: 'Customer Benefits', href: '#rewards' }
        ]
    },
    {
        title: 'Business Solutions',
        links: [
            { label: 'Partner With Repeato', action: 'owner' },
            { label: 'Business Rewards Program', action: 'owner' },
            { label: 'Customer Retention', action: 'owner' },
            { label: 'Loyalty Management', action: 'owner' },
            { label: 'Grow Your Business', action: 'owner' }
        ]
    },
    {
        title: 'Help & Support',
        links: [
            { label: 'Help Centre', dialog: 'help' },
            { label: 'Frequently Asked Questions', dialog: 'faq' },
            { label: 'Contact Us', dialog: 'contact' },
            { label: 'Account Support', action: 'customer' },
            { label: 'Report an Issue', dialog: 'report' }
        ]
    },
    {
        title: 'Legal',
        links: [
            { label: 'Terms & Conditions', dialog: 'terms' },
            { label: 'Privacy Policy', dialog: 'privacy' },
            { label: 'Cookie Policy', dialog: 'cookies' },
            { label: 'Refund & Reward Policy', dialog: 'rewards-policy' }
        ]
    }
];

const DIALOG_CONTENT = {
    help: {
        title: 'Help Centre',
        body: 'For customer account or rewards help, sign in to your customer account. For a visit that is waiting for approval, ask the participating business to confirm it. Business owners can sign in to review customers and pending visits.'
    },
    faq: {
        title: 'Frequently Asked Questions',
        body: 'Points are added when the participating business approves a visit request. Available rewards and the points needed are shown in the customer dashboard. Repeato does not send SMS OTPs or process payments.'
    },
    contact: {
        title: 'Contact Repeato',
        body: 'A Repeato support email or contact form has not been configured in this project. For a reward or visit issue, contact the participating business directly.'
    },
    report: {
        title: 'Report an Issue',
        body: 'Issue reporting is not connected to a support inbox yet. Please contact the participating business for account or visit help; a support contact can be added before launch.'
    },
    terms: {
        title: 'Terms & Conditions',
        body: 'Repeato provides loyalty account and reward tools. Each participating business sets its available rewards and approves customer visits. This product summary is a draft, not a complete legal agreement; have final terms reviewed before public launch.'
    },
    privacy: {
        title: 'Privacy Policy',
        body: 'The current app stores account name, email, password hash, points and reward activity. Customers may optionally save a birthday and notification preference. Sign-in uses an HTTP-only session cookie. Account deletion removes the customer account and related records. This summary is a draft and should be reviewed before launch.'
    },
    cookies: {
        title: 'Cookie Policy',
        body: 'The app uses an HTTP-only, same-site session cookie to keep signed-in users authenticated. The current session expires after seven days. This summary is a draft; review it against your final hosting and analytics configuration before launch.'
    },
    'rewards-policy': {
        title: 'Refund & Reward Policy',
        body: 'Redeeming an active reward deducts its points from the customer balance. The participating business fulfils the reward and should explain any offer-specific restrictions. Repeato does not process payments or issue cash refunds. This summary is a draft for business review.'
    }
};

export default function Footer({ onNavigate }) {
    const [activeDialog, setActiveDialog] = useState(null);
    const dialog = activeDialog ? DIALOG_CONTENT[activeDialog] : null;

    const renderLink = (link) => {
        if (link.href) return <a key={link.label} href={link.href}>{link.label}</a>;
        if (link.action) {
            return <button key={link.label} type="button" onClick={() => onNavigate(link.action)}>
                {link.label}<span aria-hidden="true">→</span>
            </button>;
        }
        return <button key={link.label} type="button" onClick={() => setActiveDialog(link.dialog)}>
            {link.label}
        </button>;
    };

    return <>
      <footer className="site-footer">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <div className="site-footer-logo"><Logo size={36}/><b>Repeato</b></div>
            <h2>Visit. Earn. Return.</h2>
            <p>Make every visit count. Discover your favourite local businesses, earn loyalty points and unlock exciting rewards every time you return.</p>
          </div>
          <nav className="site-footer-links" aria-label="Footer navigation">
            {GROUPS.map(group => <details className="site-footer-group" key={group.title} open>
              <summary>{group.title}</summary>
              <div className="site-footer-link-list">{group.links.map(renderLink)}</div>
            </details>)}
          </nav>
        </div>
        <div className="site-footer-bottom">
          <span>© {new Date().getFullYear()} Repeato. All Rights Reserved.</span>
          <span>Powered by Repeato.</span>
          <span className="site-footer-legal">
            <button type="button" onClick={() => setActiveDialog('privacy')}>Privacy Policy</button>
            <i aria-hidden="true"/>
            <button type="button" onClick={() => setActiveDialog('terms')}>Terms &amp; Conditions</button>
          </span>
        </div>
      </footer>
      {dialog && <div className="site-dialog-backdrop" onClick={() => setActiveDialog(null)}>
        <section className="site-dialog" role="dialog" aria-modal="true" aria-labelledby="site-dialog-title"
          onClick={event => event.stopPropagation()}>
          <button className="site-dialog-close" type="button" aria-label="Close dialog" onClick={() => setActiveDialog(null)}>×</button>
          <span className="eyebrow">REPEATO INFORMATION</span>
          <h2 id="site-dialog-title">{dialog.title}</h2>
          <p>{dialog.body}</p>
          <button className="btn sm" type="button" onClick={() => setActiveDialog(null)}>Close</button>
        </section>
      </div>}
    </>;
}
