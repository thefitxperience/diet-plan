// Phone input with a country-code (dial code) selector. Stores a single string
// like "+966 512345678" so it drops into the existing clients.phone column and
// the WhatsApp link (which strips non-digits) unchanged.

// Region-first list (gym is KSA-based), then common international codes.
const COUNTRIES = [
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: '+965', flag: '🇰🇼', name: 'Kuwait' },
  { code: '+974', flag: '🇶🇦', name: 'Qatar' },
  { code: '+973', flag: '🇧🇭', name: 'Bahrain' },
  { code: '+968', flag: '🇴🇲', name: 'Oman' },
  { code: '+962', flag: '🇯🇴', name: 'Jordan' },
  { code: '+961', flag: '🇱🇧', name: 'Lebanon' },
  { code: '+20', flag: '🇪🇬', name: 'Egypt' },
  { code: '+964', flag: '🇮🇶', name: 'Iraq' },
  { code: '+963', flag: '🇸🇾', name: 'Syria' },
  { code: '+970', flag: '🇵🇸', name: 'Palestine' },
  { code: '+967', flag: '🇾🇪', name: 'Yemen' },
  { code: '+212', flag: '🇲🇦', name: 'Morocco' },
  { code: '+213', flag: '🇩🇿', name: 'Algeria' },
  { code: '+216', flag: '🇹🇳', name: 'Tunisia' },
  { code: '+90', flag: '🇹🇷', name: 'Türkiye' },
  { code: '+1', flag: '🇺🇸', name: 'United States / Canada' },
  { code: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '+33', flag: '🇫🇷', name: 'France' },
  { code: '+49', flag: '🇩🇪', name: 'Germany' },
  { code: '+39', flag: '🇮🇹', name: 'Italy' },
  { code: '+34', flag: '🇪🇸', name: 'Spain' },
  { code: '+91', flag: '🇮🇳', name: 'India' },
  { code: '+92', flag: '🇵🇰', name: 'Pakistan' },
  { code: '+63', flag: '🇵🇭', name: 'Philippines' },
  { code: '+62', flag: '🇮🇩', name: 'Indonesia' },
  { code: '+60', flag: '🇲🇾', name: 'Malaysia' },
]
const DEFAULT_DIAL = '+966'

// Longest code first so e.g. +971 wins over +9.
const BY_LEN = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length)

function split(value) {
  const v = (value || '').trim()
  const m = BY_LEN.find((c) => v.startsWith(c.code))
  if (m) return { dial: m.code, number: v.slice(m.code.length).trim() }
  return { dial: DEFAULT_DIAL, number: v }
}

export default function PhoneField({ value = '', onChange, invalid = false }) {
  const { dial, number } = split(value)
  const emit = (d, n) => onChange(`${d} ${n}`.trimEnd())
  return (
    <div className={`phone-field ${invalid ? 'invalid' : ''}`}>
      <select value={dial} onChange={(e) => emit(e.target.value, number)} aria-label="Country code">
        {COUNTRIES.map((c) => (
          <option key={c.code + c.name} value={c.code}>{c.flag} {c.code}</option>
        ))}
      </select>
      <input
        type="tel" inputMode="tel" dir="ltr"
        className={invalid ? 'invalid' : ''}
        value={number}
        onChange={(e) => emit(dial, e.target.value.replace(/[^\d\-\s()]/g, ''))}
      />
    </div>
  )
}
