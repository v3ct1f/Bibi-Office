import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@office/ui";
import { COMPANY as C, legalIncomplete } from "../legal/company.ts";

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link>
        </nav>
        {legalIncomplete && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Draft: the company details in [square brackets] are not filled in yet. Don't take payments until they are, and have a lawyer read this text.
          </p>
        )}
        <Card>
          <CardContent className="space-y-6 py-8 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:space-y-1 [&_ul]:text-sm">
            <header>
              <h1 className="text-2xl font-semibold">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Version {C.version}</p>
            </header>
            {children}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const S = ({ title, children }: { title: string; children: ReactNode }) => <section className="space-y-2"><h2>{title}</h2>{children}</section>;

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <S title="1. Who we are and what this is">
        <p>{C.service} ("the Service") is online software for running a business: contacts, invoices, scheduling, support and more. It is provided by {C.name}, {C.address}, {C.country} (company number {C.registration}), referred to as "we". By creating an account or paying for the Service you agree to these Terms and to our <Link to="/privacy" className="underline">Privacy Policy</Link>.</p>
      </S>
      <S title="2. Who may use it">
        <p>The Service is for businesses and professionals, not for private consumers. You confirm that you sign up for a business or professional purpose and that you have the authority to accept these Terms for it.</p>
      </S>
      <S title="3. Your account">
        <ul>
          <li>The person who signs up becomes the owner of the business account and is responsible for it, including the people they add and what those people do.</li>
          <li>Keep sign-in details safe and tell us at once if you think an account has been misused.</li>
          <li>Information you give us (name, email, business name) must be correct.</li>
        </ul>
      </S>
      <S title="4. Subscription and payment">
        <ul>
          <li>The Service is a monthly subscription. The price is shown before you pay. Each month is paid in advance and the subscription renews automatically every month until cancelled.</li>
          <li>Payments are handled by Stripe. We never see or store your card details.</li>
          <li>Prices may include or be subject to VAT or other taxes where the law requires.</li>
          <li>We may change the price. We will email you at least 30 days before a change applies to you, and you may cancel before then.</li>
          <li>If a payment fails, Stripe tries again for a while. If it still fails, the account is paused until payment is made.</li>
        </ul>
      </S>
      <S title="5. Cancelling">
        <p>You can cancel at any time yourself: in the Service go to Settings, then General, then "Manage subscription". Cancelling stops the next renewal. You keep full use of the Service until the end of the month you have already paid for. After that the account is paused and you are not charged again.</p>
        <p>After the subscription ends we keep the business's data for up to {C.keepDays} days so you can come back. After that we may delete it. You can ask for a copy or for deletion earlier at any time by emailing {C.email}.</p>
      </S>
      <S title="6. No refunds">
        <p>Payments are not refundable. This includes the current month when you cancel part-way, and any unused time. This does not take away any right that the law gives you and that cannot be excluded by contract. We may, at our own choice, make a refund in a particular case; doing so once does not oblige us to do it again.</p>
      </S>
      <S title="7. Your data">
        <p>The data you put into the Service remains yours. You allow us to store and process it only to provide the Service to you, as described in the Privacy Policy. You are responsible for having the right to enter that data, for example your customers' details.</p>
        <p>Our staff and the program owner may look at a business's data when needed for support, security or to follow the law. Each such visit by the program owner is recorded in the business's own history.</p>
      </S>
      <S title="8. Acceptable use">
        <p>Do not use the Service for anything illegal, to send spam, to attack or overload it, to try to reach another business's data, or to resell it without our written agreement. We may pause an account that breaks these rules.</p>
      </S>
      <S title="9. Availability and changes">
        <p>We work to keep the Service running and to make it better, but we do not promise it will always be available or free of errors. The Service is still growing: features may be added, changed or removed. Keep your own copies of anything critical; you can export data from the Service where an export is offered.</p>
      </S>
      <S title="10. Liability">
        <p>The Service is provided "as is". To the extent the law allows, we are not liable for indirect or consequential loss (such as lost profit or lost business), and our total liability for anything connected to the Service is limited to the fees you paid us in the 12 months before the event. Nothing in these Terms limits liability that cannot be limited by law, such as for intent or gross negligence.</p>
      </S>
      <S title="11. Ending the agreement">
        <p>You may stop at any time by cancelling. We may end or pause your account if you seriously or repeatedly break these Terms, or if payment is not made. We will tell you why where we reasonably can.</p>
      </S>
      <S title="12. Changes to these Terms">
        <p>We may update these Terms. We will email the business owner before a material change takes effect. If you keep using the Service after that date, the new Terms apply; if you disagree, you can cancel.</p>
      </S>
      <S title="13. Law and courts">
        <p>These Terms are governed by the law of {C.law}. Disputes go to the competent courts of {C.law}, unless mandatory law says otherwise.</p>
      </S>
      <S title="14. Contact">
        <p>{C.name}, {C.address}, {C.country}. Email: {C.email}.</p>
      </S>
    </LegalPage>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <S title="1. Who is responsible">
        <p>{C.name}, {C.address}, {C.country} (company number {C.registration}) runs {C.service}. Contact for anything about your data: {C.email}.</p>
        <p>We have two roles. For <strong>our customers' own account and billing details</strong> (section 2) we decide how the data is used, so we are the "controller". For <strong>the business data a customer puts into the Service</strong> (their contacts, invoices, staff records and so on, section 3) the customer is the controller and we are their "processor": we only handle it on their behalf and on their instructions. A data processing agreement is available on request.</p>
      </S>
      <S title="2. What we collect about customers and why">
        <ul>
          <li><strong>Sign-up and account:</strong> name, email address, business name, chosen web address, region, the time you accepted the Terms. Needed to create and run your account (contract).</li>
          <li><strong>Sign-in:</strong> your email and a password stored only as a protected hash by our sign-in service. We never see your password.</li>
          <li><strong>Payment:</strong> Stripe handles your card and payment details. We receive only a customer and subscription reference, the status and the amounts. Needed to bill you and keep accounting records (contract and legal obligation).</li>
          <li><strong>Security and history:</strong> a log of important actions in a business (who did what, when, from which IP address) and technical logs. Needed to keep the Service secure and for you to see what happened (legitimate interest and contract).</li>
          <li><strong>Emails:</strong> the invitations, receipts and notices we send you about your account.</li>
        </ul>
      </S>
      <S title="3. Business data you put into the Service">
        <p>Whatever your business stores in the Service, such as contacts, companies, invoices, expenses, schedules, staff details, documents and support emails, is stored for you and kept separate from every other business. We use it only to provide the Service. We do not sell it, use it for advertising, or use it to train AI models.</p>
        <p>If you turn on the AI summaries feature with your own Claude key, the text you ask it to summarise is sent to Anthropic under your own account with them.</p>
        <p>The program owner (us) can look inside a business, read-only, for support and security. Every such visit is recorded in the business's own history.</p>
      </S>
      <S title="4. Who else handles data (processors)">
        <ul>
          <li><strong>Stripe</strong>, for payments. Stripe is also responsible for the payment data it collects and has its own privacy policy.</li>
          <li><strong>{C.hosting}</strong>, which hosts the Service and its database in the region you chose when signing up (Europe or the United States).</li>
          <li><strong>An email delivery service</strong>, to send account emails.</li>
          <li><strong>Anthropic</strong>, only if you use AI summaries, as described above.</li>
        </ul>
        <p>We do not sell personal data. We share it with these providers only as needed to run the Service, under contracts that require them to protect it. Where data goes to a country outside the European Economic Area (for example Stripe or Anthropic in the United States), we rely on the safeguards the law provides, such as standard contractual clauses.</p>
      </S>
      <S title="5. How long we keep it">
        <ul>
          <li>Account and business data: while your subscription is active, and up to {C.keepDays} days after it ends, then it may be deleted.</li>
          <li>Invoices and payment records of ours: as long as tax and accounting law requires.</li>
          <li>Security logs: for a limited time, normally up to 12 months.</li>
        </ul>
      </S>
      <S title="6. Your rights">
        <p>You can ask us for access to your data, to correct it, to delete it, to restrict or object to its use, and to receive it in a portable format. Email {C.email}. For data in a business account that belongs to someone else's customers, we will pass the request to the business concerned. You may also complain to the data protection authority: {C.authority}.</p>
      </S>
      <S title="7. Cookies and similar storage">
        <p>We use no advertising or tracking cookies and no analytics that follow you around. Your browser stores only what is needed to keep you signed in and to remember small preferences. Stripe's payment page may set its own cookies for fraud prevention.</p>
      </S>
      <S title="8. Security">
        <p>Each business's data is separated at database level, connections are encrypted, secrets are stored encrypted and important actions are logged in a tamper-evident history. No system is perfect; if a breach affects your data, we will tell you and the authorities as the law requires.</p>
      </S>
      <S title="9. Children">
        <p>The Service is for businesses and is not meant for children.</p>
      </S>
      <S title="10. Changes">
        <p>If we change this policy in a way that matters, we will email the business owner. The version date is at the top of this page.</p>
      </S>
    </LegalPage>
  );
}
