# Moroccan CNIE Verification Process

> Reference: [TrustDocHub — Verify Moroccan Identity Card](https://trustdochub.com/en/verify-moroccan-identity-card-cnie/)

---

## Document Overview

| Property | Value |
|---|---|
| Full name | Carte Nationale d'Identité Électronique (CNIE) |
| Issued to | Moroccan citizens aged 16+ |
| Format | ID-1 (ISO/IEC 7810) — bank card size: 85.6 × 54 mm |
| Languages | Arabic (primary) + French |
| Biometric | Yes — photo + fingerprints on embedded chip |
| MRZ | Yes — TD1 format (3 lines × 30 chars) |

---

## Document Structure

### Front Side
- Holder photo (top-left)
- Full name in **Arabic** (surname + given names)
- Full name in **French/Latin** transliteration
- CIN number (1–2 letters + 5–6 digits, e.g. `AB123456`)
- Date of birth (`DD/MM/YYYY`)
- Place of birth
- Civil status
- Address
- Expiry date
- Issuing authority

### Back Side
- MRZ zone (3 lines × 30 characters)
- Document number (repeated from MRZ line 1)
- Personal number
- Barcode / chip contact pad

---

## MRZ Structure (TD1 — 3 lines)

```
Line 1 (30 chars): I<MAR[card_number(9)][check][personal_number(8)][check]<<<<<
Line 2 (30 chars): [DOB(6)][check][sex(1)][expiry(6)][check][nationality(3)][check(composite)]<<
Line 3 (30 chars): [SURNAME<<GIVEN_NAMES<<<<<<<<<<<<<<<]
```

### Field positions

| Field | Line | Position | Length | Check digit |
|---|---|---|---|---|
| Document type | 1 | 1–2 | 2 | — |
| Issuing country | 1 | 3–5 | 3 | — |
| Card number | 1 | 6–14 | 9 | pos 15 |
| Personal number | 1 | 16–29 | 14 | pos 30 |
| Date of birth | 2 | 1–6 | 6 (YYMMDD) | pos 7 |
| Sex | 2 | 8 | 1 | — |
| Expiry date | 2 | 9–14 | 6 (YYMMDD) | pos 15 |
| Nationality | 2 | 16–18 | 3 | — |
| Composite check | 2 | 30 | 1 | lines 1+2 concat |
| Surname / names | 3 | 1–30 | 30 | — |

### Check digit algorithm

```python
WEIGHTS = [7, 3, 1]  # cycling
CHAR_VALUES = {str(d): d for d in range(10)}
CHAR_VALUES.update({"<": 0})
CHAR_VALUES.update({chr(65 + i): 10 + i for i in range(26)})  # A=10 … Z=35

def check_digit(s: str) -> int:
    total = sum(CHAR_VALUES.get(c, 0) * WEIGHTS[i % 3] for i, c in enumerate(s))
    return total % 10
```

---

## 4-Step Verification Process

### Step 0 — Automated Digital Analysis

Run before any physical checks:

- [ ] Parse MRZ using `passporteye` (TD1 format)
- [ ] Validate all 6 check digits (card_number, personal_number, DOB, expiry, nationality group, composite)
- [ ] Extract all fields and flag any checksum mismatch as **tamper signal**
- [ ] Generate timestamped verification report

> **Limitation**: No official public Moroccan CNIE database exists. MRZ consistency can be validated but not cross-checked against a government registry.

---

### Step 1 — Overall Appearance Check

Visual / CV signals to check:

- [ ] No signs of cutting, peeling, delamination, or bubbling
- [ ] Card dimensions within tolerance (±0.5 mm)
- [ ] Photo area intact — no raised edges, colour mismatch, or glue residue
- [ ] Surface uniformity — no patches, uneven texture, or discolouration
- [ ] Font consistency across all printed fields

**In pipeline**: `doc_auth` step runs Canny edge detection + colour histogram analysis for these signals.

---

### Step 2 — Data Field Cross-Checks

Every key field appears in two locations. Verify consistency:

| Field | Primary (VIZ) | Secondary (MRZ) |
|---|---|---|
| Document number | Back side top | MRZ line 1, pos 6–14 |
| Personal number | Front centre | MRZ line 1, pos 16–29 |
| Date of birth | Front centre | MRZ line 2, pos 1–6 (YYMMDD) |
| Expiry date | Front side | MRZ line 2, pos 9–14 (YYMMDD) |
| Surname | Front side (Arabic + Latin) | MRZ line 3 (Latin, `<<` separator) |

**Flag** any mismatch between VIZ (visual inspection zone) and MRZ as fraud signal.

---

### Step 3 — MRZ Validation

Full validation checklist:

- [ ] `mrz.valid == True` (all passporteye checksums pass)
- [ ] Country code = `MAR`
- [ ] Document type starts with `I`
- [ ] CIN number matches regex `^[A-Z]{1,2}\d{5,6}$`
- [ ] Date of birth is plausible (person ≥ 16 years old, ≤ 110)
- [ ] Expiry date is in the future
- [ ] No `<` in unexpected positions

---

### Step 4 — Physical Security Features

Features present on authentic CNIE (for visual + UV inspection):

**Front:**
- Laser-engraved personalization (photo + data — hard to alter)
- Guilloche background pattern
- Microprint text (visible under magnification)
- Colour-shifting ink on certain elements
- Holographic overlay (OVD — optically variable device)

**Back:**
- MRZ printed with OCR-B font (machine-readable)
- Latent image (visible only at specific viewing angle)
- UV-reactive fibres in card substrate
- Chip contact pads (embedded RFID chip)

> Standard verification (no special equipment) covers Steps 0–3.  
> Steps requiring UV lamp or chip reader are out of scope for this pipeline.

---

## Fraud Indicators

| Signal | Risk level | Pipeline check |
|---|---|---|
| MRZ checksum failure | 🔴 Critical | `ocr.mrz_valid == false` |
| VIZ ↔ MRZ field mismatch | 🔴 Critical | LLM cross-check |
| Photo replacement / tampering | 🔴 Critical | `doc_auth` + `llm_analysis` |
| Expired document | 🟠 High | expiry_date < today |
| Holder age < 16 | 🟠 High | DOB check in OCR |
| Face ≠ photo on ID | 🔴 Critical | `face_match.match == false` |
| Selfie not live | 🔴 Critical | `liveness.live == false` |
| Low OCR confidence | 🟡 Medium | `ocr.ocr_confidence < 0.5` |
| Edge artefacts / copy-paste | 🟠 High | `doc_auth.flags` |
| CIN format invalid | 🟠 High | regex `^[A-Z]{1,2}\d{5,6}$` |

---

## Expected Extracted Fields (national_id)

```json
{
  "cin_number":       "AB123456",
  "full_name_latin":  "HASSAN BENALI",
  "full_name_arabic": "حسن بن علي",
  "date_of_birth":    "1990-05-01",
  "place_of_birth":   "Casablanca",
  "address":          "12 Rue des Orangers, Rabat",
  "expiry_date":      "2030-03-15",
  "civil_status":     "married"
}
```

---

## Pipeline Mapping

```
Image upload
    │
    ▼
[doc_auth]      ── Canny edges, histogram, resolution, template match
    │
    ▼
[ocr]           ── EasyOCR (Arabic + English) → GPT-4o-mini field extraction
    │               + passporteye MRZ parse + checksum validation
    ▼
[face_match]    ── DeepFace ArcFace: ID photo ↔ selfie distance < 0.40
    │
    ▼
[liveness]      ── MediaPipe: passive flat-photo vs live-face detection
    │
    ▼
[llm_analysis]  ── GPT-4o vision: layout check, field cross-check, risk narrative
    │
    ▼
[scoring]       ── Weighted 0–100 score → approved / review / rejected
```

---

## References

- [TrustDocHub — Verify Moroccan Identity Card CNIE](https://trustdochub.com/en/verify-moroccan-identity-card-cnie/)
- [ICAO Doc 9303 — Machine Readable Travel Documents (TD1)](https://www.icao.int/publications/pages/publication.aspx?docnum=9303)
- [passporteye MRZ library](https://github.com/konstantint/PassportEye)
