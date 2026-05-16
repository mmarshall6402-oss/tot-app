export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "'Space Grotesk', sans-serif", padding: "40px 24px", maxWidth: 680, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap'); *{box-sizing:border-box;} a{color:#00FF87;}`}</style>
      <a href="/" style={{ fontSize: 13, color: "#444", textDecoration: "none" }}>← Back</a>
      <h1 style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, margin: "24px 0 8px" }}>T<span style={{ color: "#00FF87" }}>|</span>T Privacy Policy</h1>
      <p style={{ color: "#444", fontSize: 13, marginBottom: 32 }}>Last updated: May 2026</p>

      <Section title="1. What We Collect">
        <strong>Account data:</strong> email address and authentication credentials, stored securely via Supabase.{"\n\n"}
        <strong>Usage data:</strong> picks you save, results you mark, and subscription status.{"\n\n"}
        <strong>Payment data:</strong> processed entirely by Stripe. We never see or store your card number.
      </Section>

      <Section title="2. How We Use It">
        We use your data to provide the ToT service — displaying picks, tracking your saved bets, and managing your subscription. We do not sell your data. We do not use it for advertising.
      </Section>

      <Section title="3. Third-Party Services">
        <strong>Supabase</strong> — authentication and database hosting.{"\n"}
        <strong>Stripe</strong> — payment processing and subscription management.{"\n"}
        <strong>Vercel</strong> — application hosting and serverless functions.{"\n\n"}
        Each provider has its own privacy policy and data practices.
      </Section>

      <Section title="4. Data Retention">
        Your account data is retained as long as your account is active. You may request deletion of your account and associated data at any time by contacting us.
      </Section>

      <Section title="5. Security">
        We use industry-standard practices including encrypted connections (HTTPS), hashed authentication tokens, and row-level security on our database. No system is perfectly secure — use a strong, unique password.
      </Section>

      <Section title="6. Cookies">
        We use a session cookie to keep you logged in. No advertising cookies or third-party tracking cookies are used.
      </Section>

      <Section title="7. Your Rights">
        You may access, correct, or delete your personal data at any time. To request this, sign in and contact us through the app. We will respond within 30 days.
      </Section>

      <Section title="8. Changes">
        We may update this policy as the service evolves. Material changes will be communicated via email or in-app notice.
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: 14, color: "#666", lineHeight: 1.8, whiteSpace: "pre-line" }}>{children}</p>
    </div>
  );
}
