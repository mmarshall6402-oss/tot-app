export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#888", padding: "40px 20px", maxWidth: 640, margin: "0 auto", fontFamily: "sans-serif", lineHeight: 1.7, fontSize: 14 }}>
      <a href="/" style={{ color: "#00FF87", fontSize: 12, textDecoration: "none" }}>← Back</a>
      <h1 style={{ color: "#fff", marginTop: 24, marginBottom: 8, fontSize: 22 }}>Privacy Policy</h1>
      <p style={{ color: "#444", fontSize: 12, marginBottom: 24 }}>Last updated: May 2026</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>Information We Collect</h2>
      <p>We collect your email address when you create an account. We store picks you save in your tracker and your subscription status. We do not collect payment information directly — payments are processed securely by Stripe.</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>How We Use Your Information</h2>
      <p>Your email is used to authenticate your account and send essential service communications. Saved picks and tracker data are stored to provide the tracker feature. We do not sell your data to third parties.</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>Data Storage</h2>
      <p>Account and tracker data is stored in Supabase, a secure cloud database. All data is encrypted at rest and in transit. We retain your data as long as your account is active.</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>Cookies</h2>
      <p>We use session cookies for authentication only. We do not use tracking or advertising cookies.</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>Your Rights</h2>
      <p>You may delete your account and all associated data at any time by contacting us. You may also export your tracker data by contacting support.</p>

      <h2 style={{ color: "#fff", fontSize: 15, marginTop: 24, marginBottom: 8 }}>Contact</h2>
      <p>For privacy questions or data deletion requests, contact us through the app.</p>
    </div>
  );
}
