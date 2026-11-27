// DEMO ONLY — sends the SOS message to ONE configured phone number that stands in for the local emergency service
// (ambulance, police, fire …). It exists to show what a real dispatch integration would send. It never contacts a
// real hospital, police station or 112, and it is refused when NODE_ENV=production.
//
// Transport "macos-messages": the local API asks the Mac's Messages app (AppleScript) to send the text — iMessage, or
// SMS through a paired iPhone with Text Message Forwarding. macOS asks once for permission to control Messages.
// Transport "log": the message is only printed by the server (for machines without Messages).
// "sent" means Messages accepted the message for sending — not that anyone has read it.
import { execFile } from 'node:child_process';

export const EMERGENCY_TYPES = {
  medical:        { label: 'Medical emergency',            service: 'Ambulance / medical service', category: 'medical' },
  accident:       { label: 'Accident or injury',           service: 'Ambulance / medical service', category: 'accident' },
  theft:          { label: 'Theft or robbery',             service: 'Police',                      category: 'security' },
  assault:        { label: 'Assault, harassment or threat', service: 'Police',                     category: 'security' },
  fire:           { label: 'Fire',                         service: 'Fire service',                category: 'other' },
  natural_hazard: { label: 'Flood, storm or landslide',    service: 'Disaster response',           category: 'natural_hazard' },
  lost:           { label: 'Lost or stranded',             service: 'Police / tourist help',       category: 'lost_traveller' },
  lost_documents: { label: 'Lost passport or documents',   service: 'Police',                      category: 'security' },
  unsafe:         { label: 'Unsafe place',                 service: 'Police',                      category: 'unsafe_location' },
  other:          { label: 'Other / cannot say',           service: 'Emergency services',          category: 'other' },
} as const;
export type EmergencyType = keyof typeof EMERGENCY_TYPES;

export interface DispatchInput {
  reference: string;
  emergencyType: EmergencyType;
  reporterName: string | null;
  contactNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  stay: { hotel_name: string; city: string | null; checkin: string; checkout: string; reference: string } | null;
  notes: string | null;
  createdAt: Date;
}

export interface DispatchResult {
  status: 'sent' | 'logged' | 'failed' | 'disabled';
  service: string;
  to_masked: string | null;
  message: string | null;
  error?: string;
  /** Click-to-chat link with the same text, so the demo can also be sent by hand from WhatsApp. */
  whatsapp_url?: string;
}

/** A short, actionable reason from an osascript failure (never the whole script). */
export function explainFailure(stderr: string, message: string): string {
  const text = `${stderr}\n${message}`;
  if (/-1728|-10000|Can.t get .*account/i.test(text)) {
    return 'Messages is not signed in on this Mac. Open Messages, sign in with an Apple ID, and for SMS turn on ' +
      'Text Message Forwarding on your iPhone.';
  }
  if (/-1743|not authori[sz]ed|Not allowed/i.test(text)) {
    return 'macOS blocked the request: allow Terminal/Node to control Messages in System Settings → Privacy & Security → Automation.';
  }
  const line = text.split('\n').map(l => l.trim()).find(l => /execution error/i.test(l));
  return (line ?? 'Messages could not send the message').slice(0, 200);
}

export function maskNumber(n: string) {
  const d = n.replace(/\s/g, '');
  return d.length <= 6 ? '•••' : `${d.slice(0, 5)}•••${d.slice(-4)}`;
}

/** The text the demo responder receives. Facts only; it says plainly that the alert is unverified. */
export function composeMessage(x: DispatchInput): string {
  const t = EMERGENCY_TYPES[x.emergencyType];
  const when = x.createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const lines = [
    `TravelSphere SOS (DEMO) - ${t.label.toUpperCase()}`,
    `For: ${t.service}`,
    `A TravelSphere traveller pressed SOS. This alert is NOT verified - please call them first.`,
    `Ref: ${x.reference} - ${when} IST`,
  ];
  if (x.reporterName) lines.push(`Traveller: ${x.reporterName}`);
  if (x.contactNumber) lines.push(`Phone: ${x.contactNumber}`);
  if (x.stay) {
    lines.push(`Staying at: ${x.stay.hotel_name}${x.stay.city ? `, ${x.stay.city}` : ''} (booking ${x.stay.reference}, ` +
      `${x.stay.checkin} to ${x.stay.checkout})`);
  }
  if (x.latitude !== null && x.longitude !== null) {
    const acc = x.accuracyM ? ` (+/-${Math.round(x.accuracyM)} m)` : '';
    lines.push(`Location: ${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}${acc}`);
    lines.push(`Map: https://maps.google.com/?q=${x.latitude.toFixed(5)},${x.longitude.toFixed(5)}`);
  } else {
    lines.push(x.stay ? 'Live location not shared - start at the hotel above.' : 'Live location not shared.');
  }
  if (x.notes) lines.push(`Notes: ${x.notes}`);
  lines.push('If you cannot reach the traveller, go to the location or contact the local emergency number.');
  return lines.join('\n');
}

// Message and number are passed as arguments (argv), never interpolated into the script.
const SCRIPT = `on run argv
  set targetNumber to item 1 of argv
  set theMessage to item 2 of argv
  tell application "Messages"
    try
      set svc to 1st account whose service type = iMessage
      send theMessage to participant targetNumber of svc
    on error
      set svc to 1st account whose service type = SMS
      send theMessage to participant targetNumber of svc
    end try
  end tell
end run`;

type Exec = (file: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => void;

export function createDemoDispatcher(opts: { number?: string; transport?: 'macos-messages' | 'log'; production: boolean },
  exec: Exec = (f, a, cb) => { execFile(f, a, { timeout: 20_000 }, (e, so, se) => cb(e, String(so), String(se))); }) {
  const enabled = !!opts.number && !opts.production;
  return {
    enabled,
    toMasked: enabled ? maskNumber(opts.number!) : null,
    async send(x: DispatchInput): Promise<DispatchResult> {
      const service = EMERGENCY_TYPES[x.emergencyType].service;
      if (!enabled) return { status: 'disabled', service, to_masked: null, message: null };
      const message = composeMessage(x);
      const to_masked = maskNumber(opts.number!);
      const whatsapp_url = `https://wa.me/${opts.number!.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
      if (opts.transport === 'log') {
        console.log(`[demo-dispatch] to ${to_masked}:\n${message}`);
        return { status: 'logged', service, to_masked, message, whatsapp_url };
      }
      return new Promise(resolve => {
        exec('osascript', ['-e', SCRIPT, opts.number!, message], (err, _out, stderr) => {
          if (err) {
            const why = explainFailure(stderr ?? '', err.message);
            console.warn('[demo-dispatch] Messages did not send:', why);
            resolve({ status: 'failed', service, to_masked, message, error: why, whatsapp_url });
          } else {
            resolve({ status: 'sent', service, to_masked, message, whatsapp_url });
          }
        });
      });
    },
  };
}
export type DemoDispatcher = ReturnType<typeof createDemoDispatcher>;
