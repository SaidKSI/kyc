import Link from "next/link";

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-0.5">
      <circle cx="8" cy="8" r="8" fill="#16a34a" fillOpacity="0.12" />
      <path d="M5 8l2 2 4-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Create a Session",
    desc: "Your backend calls POST /v1/verify with an API key and gets back a short-lived session token.",
    code: `POST /v1/verify
X-API-Key: kyc_...

{
  "reference_id": "user_123",
  "document_type": "national_id"
}`,
  },
  {
    n: "02",
    title: "User Verifies",
    desc: "Send the verify_url to your user. They open it on their phone, capture their ID and selfie — no app install required.",
    code: `// returned by the API
{
  "session_token": "ses_...",
  "verify_url":
    "https://kyc.app/verify/ses_..."
}`,
  },
  {
    n: "03",
    title: "Receive the Result",
    desc: "Once the ML pipeline finishes, your webhook receives the decision with extracted fields and a risk score.",
    code: `POST https://yourapp.com/webhook

{
  "status": "approved",
  "score": 87,
  "extracted_fields": {
    "full_name": "Mohammed Alami",
    "cin_number": "AB123456"
  }
}`,
  },
];

const FEATURES = [
  {
    icon: "🪪",
    title: "Document Authentication",
    desc: "Edge integrity, copy-move detection, EXIF analysis, and template matching against known Moroccan document layouts.",
  },
  {
    icon: "🔤",
    title: "Bilingual OCR",
    desc: "EasyOCR fine-tuned for Arabic + French + Latin scripts. Extracts all fields from CIN, passport, residence permit, and driver's license.",
  },
  {
    icon: "🤳",
    title: "Face Matching",
    desc: "ArcFace embeddings compare the selfie to the ID photo. Cosine distance threshold < 0.40 for a confirmed match.",
  },
  {
    icon: "👁️",
    title: "Passive Liveness",
    desc: "MediaPipe Face Mesh detects depth variance and texture patterns to distinguish a live face from a printed photo.",
  },
  {
    icon: "📊",
    title: "Risk Scoring",
    desc: "Weighted 0–100 score across all checks. Auto-approve above threshold, auto-reject below, manual queue in between.",
  },
  {
    icon: "🔔",
    title: "Signed Webhooks",
    desc: "Instant result delivery via HMAC-SHA256 signed POST. Exponential backoff retry up to 5 attempts.",
  },
];

const DOCS = [
  { name: "Moroccan CIN", detail: "Front + back · Arabic/Latin OCR · MRZ validation" },
  { name: "Passport (all)", detail: "TD1/TD2/TD3 · 7-checksum MRZ · 190+ countries" },
  { name: "Residence Permit", detail: "Carte de séjour · Front + back" },
  { name: "Driver's License", detail: "Permis de conduire · Categories extracted" },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-zinc-900" style={{ fontFamily: "var(--font-geist-mono)" }}>

      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="border-b border-zinc-200 sticky top-0 z-50 bg-white/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldIcon className="w-5 h-5 text-zinc-900" />
            <span className="font-bold text-sm tracking-tight">KYC Platform</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-zinc-500">
            <a href="#how-it-works" className="hover:text-zinc-900 transition-colors">How it works</a>
            <a href="#features" className="hover:text-zinc-900 transition-colors">Features</a>
            <a href="#documents" className="hover:text-zinc-900 transition-colors">Documents</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/docs" className="hidden sm:block text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
              API Docs
            </a>
            <Link
              href="/verify"
              className="h-8 px-4 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition-colors flex items-center"
            >
              Get API Access
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Built for MENA · Arabic + French document support
        </div>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-zinc-900 leading-tight mb-6 max-w-3xl mx-auto">
          Identity verification<br className="hidden sm:block" /> that works in{" "}
          <span className="text-emerald-600">seconds</span>
        </h1>
        <p className="text-zinc-500 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
          Self-hosted KYC for MENA fintechs and marketplaces. One API call — your users
          verify on mobile, you get a signed webhook with the decision and extracted data.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/verify"
            className="w-full sm:w-auto h-12 px-8 rounded-xl bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-700 transition-colors flex items-center justify-center"
          >
            Try the demo →
          </Link>
          <a
            href="/docs"
            className="w-full sm:w-auto h-12 px-8 rounded-xl border border-zinc-200 text-zinc-600 font-medium text-sm hover:border-zinc-400 hover:text-zinc-900 transition-colors flex items-center justify-center"
          >
            Read the docs
          </a>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-400">
          {[
            "Self-hosted — your data stays on your servers",
            "No per-verification fees",
            "Open source",
          ].map((t) => (
            <span key={t} className="flex items-center gap-2">
              <CheckIcon /> {t}
            </span>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how-it-works" className="border-t border-zinc-100 py-24 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-3">Three steps to verify</h2>
            <p className="text-zinc-500 text-sm max-w-md mx-auto">
              Integrate once. Your users verify from their phone — no SDK, no app install.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {STEPS.map((step) => (
              <div key={step.n} className="rounded-2xl border border-zinc-200 bg-white p-6 flex flex-col gap-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-300">{step.n}</span>
                  <h3 className="font-semibold text-zinc-900 text-sm">{step.title}</h3>
                </div>
                <p className="text-zinc-500 text-sm leading-relaxed">{step.desc}</p>
                <pre className="mt-auto text-xs text-emerald-700 bg-zinc-950 rounded-xl p-4 overflow-x-auto leading-relaxed">
                  {step.code}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────── */}
      <section id="features" className="border-t border-zinc-100 py-24">
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-3">Full ML pipeline, out of the box</h2>
            <p className="text-zinc-500 text-sm max-w-md mx-auto">
              Every verification runs five checks in sequence — all async, all audited.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-zinc-900 text-sm mb-2">{f.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Supported documents ─────────────────────────────── */}
      <section id="documents" className="border-t border-zinc-100 py-24 bg-zinc-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid sm:grid-cols-2 gap-14 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-4">
                Built for Moroccan documents
              </h2>
              <p className="text-zinc-500 text-sm leading-relaxed mb-8">
                OCR fine-tuned on Arabic and French mixed-script documents. MRZ checksum
                validation for all passport formats. Template matching for known CIN layouts.
              </p>
              <div className="space-y-4">
                {DOCS.map((d) => (
                  <div key={d.name} className="flex items-start gap-3">
                    <CheckIcon />
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">{d.name}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{d.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-950 p-7 shadow-sm">
              <p className="text-xs text-zinc-500 mb-4">Pipeline output example</p>
              <pre className="text-xs text-emerald-400 leading-relaxed whitespace-pre-wrap">{`{
  "status": "approved",
  "score": 87,
  "decision": "approved",
  "extracted_fields": {
    "full_name": "Mohammed Alami",
    "full_name_arabic": "محمد العلمي",
    "cin_number": "AB123456",
    "date_of_birth": "1990-04-12",
    "expiry_date": "2030-04-12",
    "place_of_birth": "Casablanca"
  },
  "checks": {
    "doc_auth":   { "authentic": true,  "confidence": 0.94 },
    "ocr":        { "ocr_confidence": 0.91, "mrz_valid": true },
    "face_match": { "match": true, "distance": 0.28 },
    "liveness":   { "live": true, "confidence": 0.89 }
  }
}`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="border-t border-zinc-100 py-24">
        <div className="max-w-2xl mx-auto px-5 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-4">Ready to integrate?</h2>
          <p className="text-zinc-500 text-sm mb-8">
            Run the dev tool, create a session, and test the full verification flow in under 5 minutes.
          </p>
          <Link
            href="/verify"
            className="inline-flex h-12 px-8 items-center rounded-xl bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-700 transition-colors"
          >
            Open dev console →
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-zinc-100 py-8">
        <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-4 h-4" />
            <span>KYC Platform</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/docs" className="hover:text-zinc-600 transition-colors">API Docs</a>
            <a href="/verify" className="hover:text-zinc-600 transition-colors">Dev Console</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
