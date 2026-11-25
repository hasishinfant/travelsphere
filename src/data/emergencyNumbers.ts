// Emergency telephone numbers by country, each tied to the official page it came from.
//
// verification:
//   'verified'    — the official page was read on `checked` and states the number(s) listed.
//   'unconfirmed' — the official source was found, but its page could not be read directly (blocked automated
//                   access), or the publisher could not be confirmed. Shown with that warning.
// A country not listed here has NO number in TravelSphere: the app says so and asks the traveller to check locally.
// Never add a number without a source. See docs/EMERGENCY_SYSTEM_IMPLEMENTATION_REPORT.md §8.

export type Service = 'general' | 'police' | 'ambulance' | 'fire' | 'tourist_police';

export interface EmergencyNumber {
  service: Service;
  number: string;
  label: string;
}

export interface CountryNumbers {
  code: string;                 // ISO 3166-1 alpha-2
  name: string;
  numbers: EmergencyNumber[];
  source: { title: string; url: string };
  verification: 'verified' | 'unconfirmed';
  checked: string;              // YYYY-MM-DD the source was last checked by us
  note?: string;
}

const CHECKED = '2026-11-25';

const EU_SOURCE = {
  title: 'European Commission, Your Europe: “Emergency number 112” (“112 is the only number you can use to access the emergency services in all EU countries”)',
  url: 'https://europa.eu/youreurope/citizens/travel/safety/emergency/index_en.htm',
};
const EU_NOTE = 'Some EU countries also keep national emergency numbers alongside 112; TravelSphere lists only 112 here.';

const EU: [string, string][] = [
  ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'],
  ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'],
  ['IE', 'Ireland'], ['IT', 'Italy'], ['LV', 'Latvia'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'],
  ['NL', 'Netherlands'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SK', 'Slovakia'], ['SI', 'Slovenia'],
  ['ES', 'Spain'], ['SE', 'Sweden'],
];

const general = (number: string, label = 'All emergency services'): EmergencyNumber => ({ service: 'general', number, label });

export const EMERGENCY_NUMBERS: CountryNumbers[] = ([
  ...EU.map(([code, name]): CountryNumbers => ({
    code, name, numbers: [general('112')], source: EU_SOURCE, verification: 'verified', checked: CHECKED, note: EU_NOTE,
  })),
  {
    code: 'FR', name: 'France',
    numbers: [general('112', 'European emergency number'), { service: 'ambulance', number: '15', label: 'Medical emergency (SAMU)' },
      { service: 'police', number: '17', label: 'Police (Police secours)' }, { service: 'fire', number: '18', label: 'Fire and rescue (Pompiers)' }],
    source: { title: 'Service-Public.gouv.fr, “Numéros d’urgence” (F33954)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F33954' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'IS', name: 'Iceland', numbers: [general('112')],
    source: { title: 'Neyðarlínan 112 (Iceland’s national emergency number)', url: 'https://www.112.is/en' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'GB', name: 'United Kingdom', numbers: [general('999', 'Police, ambulance, fire, coastguard'), general('112', 'Same service as 999')],
    source: { title: 'GOV.UK, “999 and 112: the UK’s national emergency numbers”', url: 'https://www.gov.uk/guidance/999-and-112-the-uks-national-emergency-numbers' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'JP', name: 'Japan',
    numbers: [{ service: 'police', number: '110', label: 'Police' }, { service: 'ambulance', number: '119', label: 'Ambulance and fire' }],
    source: { title: 'City of Yokohama, “Emergency calls (110 / 119)”', url: 'https://www.city.yokohama.lg.jp/lang/residents/en/emergencies/20200221091958448.html' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'NZ', name: 'New Zealand', numbers: [general('111')],
    source: { title: 'New Zealand Government (govt.nz), “111 emergency service”', url: 'https://www.govt.nz/browse/law-crime-and-justice/crimes-and-emergencies/111-emergency-service/' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'SG', name: 'Singapore',
    numbers: [{ service: 'police', number: '999', label: 'Police' }, { service: 'ambulance', number: '995', label: 'Ambulance and fire (SCDF)' }],
    source: { title: 'Singapore Police Force and Singapore Civil Defence Force websites', url: 'https://www.scdf.gov.sg/' },
    verification: 'verified', checked: CHECKED,
    note: 'Police number from police.gov.sg; 995 from scdf.gov.sg (“For emergencies, please call 995”).',
  },
  {
    code: 'AE', name: 'United Arab Emirates',
    numbers: [{ service: 'police', number: '999', label: 'Police' }, { service: 'ambulance', number: '998', label: 'Ambulance' },
      { service: 'fire', number: '997', label: 'Civil Defence (fire)' }],
    source: { title: 'UAE Government portal (u.ae), “Emergency Contacts”', url: 'https://u.ae/en' },
    verification: 'verified', checked: CHECKED,
  },
  {
    code: 'TH', name: 'Thailand',
    numbers: [{ service: 'police', number: '191', label: 'Emergency Call Center (Royal Thai Police)' },
      { service: 'ambulance', number: '1669', label: 'Medical Emergency Call Center' },
      { service: 'tourist_police', number: '1155', label: 'Tourist Police Bureau' }],
    source: { title: 'Government Public Relations Department (thailand.go.th), “Essential tourist assistance contact numbers”', url: 'https://thailand.go.th/issue-focus-detail/essential-tourist-assistance-contact-numbers-to-ensure-a-smooth-and-safe-journey' },
    verification: 'verified', checked: CHECKED, note: 'The source does not state a separate fire number.',
  },
  {
    code: 'CH', name: 'Switzerland', numbers: [general('112')],
    source: { title: 'European Commission, “112 – the European emergency number” (112 “is also used in some countries outside the EU – such as Switzerland and South Africa”)', url: 'https://digital-strategy.ec.europa.eu/en/policies/112' },
    verification: 'verified', checked: CHECKED, note: 'Switzerland also has national numbers; this source states only 112.',
  },
  // ---- unconfirmed: official source identified, page not readable by our automated check ----
  {
    code: 'US', name: 'United States', numbers: [general('911')],
    source: { title: '911.gov (U.S. National 911 Program), “About 911”', url: 'https://www.911.gov/about' },
    verification: 'unconfirmed', checked: CHECKED,
  },
  {
    code: 'CA', name: 'Canada', numbers: [general('911')],
    source: { title: 'CRTC, “9-1-1 services”', url: 'https://crtc.gc.ca/eng/phone/911/' },
    verification: 'unconfirmed', checked: CHECKED,
  },
  {
    code: 'IN', name: 'India', numbers: [general('112', 'Emergency Response Support System (ERSS)')],
    source: { title: 'Ministry of Home Affairs, “Emergency Response Support System (ERSS)”', url: 'https://www.mha.gov.in/en/commoncontent/emergency-response-support-system-erss' },
    verification: 'unconfirmed', checked: CHECKED,
  },
  {
    code: 'AU', name: 'Australia', numbers: [general('000', 'Triple Zero'), general('112', 'From mobile phones only')],
    source: { title: 'Australian Government, “How to call Triple Zero (000)”', url: 'https://www.infrastructure.gov.au/media-communications/phone/triple-zero/how-call-triple-zero-000' },
    verification: 'unconfirmed', checked: CHECKED,
  },
  {
    code: 'ID', name: 'Indonesia',
    numbers: [general('112', 'Emergency call (Panggilan Darurat)'), { service: 'police', number: '110', label: 'Police (Polisi)' },
      { service: 'fire', number: '113', label: 'Fire (Pemadam kebakaran)' }],
    source: { title: 'IndonesiaBaik.id infographic, “Catat ya! Nomor telefon darurat”', url: 'https://indonesiabaik.id/infografis/catat-ya-nomor-telefon-darurat-saat-kondisi-gawat' },
    verification: 'unconfirmed', checked: CHECKED,
    note: 'The page does not name its publisher and appears to be several years old. Its ambulance numbers apply to Jakarta only, so none are listed here.',
  },
] as CountryNumbers[]).sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(EMERGENCY_NUMBERS.map(c => [c.code, c]));

export const numbersFor = (code: string | null | undefined): CountryNumbers | null =>
  (code && BY_CODE.get(code.toUpperCase())) || null;

/** tel: link for a number (digits only). Opening it hands the call to the device; it doesn't mean the call connected. */
export const telHref = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`;
