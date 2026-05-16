export default function Terms() {
  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "'Space Grotesk', sans-serif", padding: "40px 24px", maxWidth: 680, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap'); *{box-sizing:border-box;} a{color:#00FF87;}`}</style>
      <a href="/" style={{ fontSize: 13, color: "#444", textDecoration: "none" }}>← Back</a>
      <h1 style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, margin: "24px 0 8px" }}>T<span style={{ color: "#00FF87" }}>|</span>T Terms of Service</h1>
      <p style={{ color: "#444", fontSize: 13, marginBottom: 32 }}>Last updated: May 2026</p>

      <Section title="1. Entertainment Only">
        ToT provides sports analysis and picks for <strong>entertainment and informational purposes only</strong>. Nothing on this platform constitutes gambling advice, financial advice, or a guarantee of any outcome. Past model performance does not guarantee future results.
      </Section>

      <Section title="2. Eligibility">
        You must be at least 21 years of age and located in a jurisdiction where sports betting is legal to use this service. By creating an account, you confirm that you meet these requirements. It is your responsibility to know and comply with your local laws.
      </Section>

      <Section title="3. Subscription">
        ToT Pro is a recurring subscription billed monthly ($2/month) or annually ($19.99/year). You may cancel at any time through the billing portal. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial periods.
      </Section>

      <Section title="4. No Liability for Losses">
        ToT is not responsible for any gambling losses, financial losses, or damages of any kind resulting from use of this service. Betting involves risk. You bet at your own discretion and risk.
      </Section>

      <Section title="5. Responsible Gambling">
        If gambling is negatively affecting your life, please seek help. Resources include:{" "}
        <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">National Council on Problem Gambling</a> and the 24/7 helpline: <strong>1-800-GAMBLER</strong>.
      </Section>

      <Section title="6. Intellectual Property">
        All content, picks, analysis, and model outputs on ToT are proprietary. You may not reproduce, distribute, or resell any content without written permission.
      </Section>

      <Section title="7. Modifications">
        We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the updated terms.
      </Section>

      <Section title="8. Contact">
        Questions? Reach us through the app or at the contact information on file with your account.
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{title}</h2>
      <p style={{ fontSize: 14, color: "#666", lineHeight: 1.8 }}>{children}</p>
    </div>
  );
}
