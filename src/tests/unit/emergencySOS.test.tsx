// SOS, emergency numbers, nearby facilities and incident status: every state shown must match what happened.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.fn();
const ensureSession = vi.fn(async () => true);
vi.mock('@/services/apiClient', async importActual => ({
  ...(await importActual<typeof import('@/services/apiClient')>()),
  api: (...a: unknown[]) => api(...a),
  ensureSession: () => ensureSession(),
  getSession: () => ({ token: 't', userId: 'r1', mode: 'local-dev' }),
}));

import { ApiError } from '@/services/apiClient';
import { SOSButton } from '@/components/emergency/SOSButton';
import { EmergencyCallPanel } from '@/components/emergency/EmergencyCallPanel';
import { NearbyResources } from '@/components/emergency/NearbyResources';
import { IncidentDetailView } from '@/components/emergency/IncidentDetailView';
import { EMERGENCY_NUMBERS, numbersFor, telHref } from '@/data/emergencyNumbers';
import { classify, responderText, statusText } from '@/services/emergency';

type Geo = { ok: true; lat: number; lon: number } | { ok: false; code: 1 | 2 | 3 } | 'never';
function mockGeolocation(result: Geo) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, err: PositionErrorCallback) => {
    if (result === 'never') return;
    if (result.ok) ok({ coords: { latitude: result.lat, longitude: result.lon, accuracy: 20 } } as GeolocationPosition);
    else err({ code: result.code, message: 'x' } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

const incident = (over: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222', reference: 'INC-SOS00001', reporter_id: 'u1', category: 'other',
  priority: 'critical', status: 'open', title: 'SOS', description: null, latitude: null, longitude: null,
  location_accuracy_m: null, occurred_at: new Date().toISOString(), is_sos: true, verified: false, assigned_to: null, details: {},
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
});

let created: any[] = [];
function serve(onCreate?: (body: any) => unknown) {
  created = [];
  api.mockImplementation(async (path: string, init?: { method?: string; body?: any }) => {
    if (path === '/v1/incidents' && init?.method === 'POST') {
      created.push(init.body);
      if (onCreate) return onCreate(init.body);
      const b = init.body;
      return { incident: incident({ latitude: b.latitude ?? null, longitude: b.longitude ?? null, details: b.details }),
        duplicate: created.length > 1, responder_accounts: 2 };
    }
    if (path === '/v1/emergency/country') return { country_code: 'FR' };
    if (path.endsWith('/location')) return { incident: incident({ latitude: init!.body.latitude, longitude: init!.body.longitude }) };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  localStorage.clear();
  api.mockReset();
  ensureSession.mockReset().mockResolvedValue(true);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SOS', () => {
  it('lists every emergency type and sends the chosen one with its category (demo dispatch shown as sent)', async () => {
    mockGeolocation({ ok: true, lat: 12.9791, lon: 77.5913 });
    serve(b => ({ incident: incident({ category: b.category, title: b.title, latitude: b.latitude, longitude: b.longitude,
      details: b.details }), duplicate: false, responder_accounts: 1,
      demo_dispatch: { status: 'sent', service: 'Ambulance / medical service', to_masked: '+9163•••0000',
        message: 'TravelSphere SOS (DEMO) - MEDICAL EMERGENCY' } }));
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    for (const label of ['Medical emergency', 'Accident or injury', 'Theft or robbery', 'Assault or harassment', 'Fire',
      'Flood, storm or landslide', 'Lost or stranded', 'Lost passport', 'Unsafe place']) {
      expect(screen.getByRole('button', { name: `Send SOS: ${label}` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send SOS: Medical emergency' }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created[0]).toMatchObject({ category: 'medical', title: 'SOS: Medical emergency', is_sos: true,
      details: { emergency_type: 'medical', location_status: 'captured' } });
    expect(screen.getByText(/handed to Messages for the demo/)).toBeInTheDocument();
    expect(screen.getByText(/Real hospitals,\s+police and 112 are not contacted/)).toBeInTheDocument();
  });

  it('says plainly when the demo message was not sent', async () => {
    mockGeolocation({ ok: false, code: 1 });
    serve(b => ({ incident: incident({ details: b.details, category: b.category }), duplicate: false, responder_accounts: 1,
      demo_dispatch: { status: 'failed', service: 'Police', to_masked: '+9163•••0000', message: 'x',
        error: 'Messages is not signed in on this Mac', whatsapp_url: 'https://wa.me/910000000000?text=x' } }));
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send SOS: Theft or robbery' }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created[0]).toMatchObject({ category: 'security', details: { emergency_type: 'theft' } });
    expect(screen.getByText('not sent')).toBeInTheDocument();
    expect(screen.queryByText(/handed to Messages/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it on WhatsApp instead' })).toHaveAttribute('href', 'https://wa.me/910000000000?text=x');
  });

  it('asks first, then registers a critical SOS with location and shows what that means', async () => {
    mockGeolocation({ ok: true, lat: 48.8566, lon: 2.3522 });
    serve();
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    // Nothing is sent just by opening SOS
    expect(created).toHaveLength(0);
    expect(screen.getByText(/It does not contact police, ambulance or hospitals/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));

    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created[0]).toMatchObject({ is_sos: true, latitude: 48.8566, longitude: 2.3522, location_accuracy_m: 20,
      details: { location_status: 'captured' } });
    expect(screen.getByText(/Included \(48\.8566, 2\.3522\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 TravelSphere responder accounts can see it\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/help is on the way|dispatched|emergency services (were|have been) (contacted|notified)/i);
    // The country of the SOS position drives the numbers shown
    expect(await screen.findByText('15')).toBeInTheDocument(); // France: SAMU
  });

  it('registers without a location when permission is denied, and says so', async () => {
    mockGeolocation({ ok: false, code: 1 });
    serve();
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created[0].latitude).toBeUndefined();
    expect(created[0].details).toEqual({ location_status: 'denied', emergency_type: 'other' });
    expect(screen.getByText(/Location permission is blocked, so your position was not included/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try adding my location/i })).toBeInTheDocument();
  });

  it('lets the traveller send without waiting for GPS', async () => {
    mockGeolocation('never');
    serve();
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));
    expect(await screen.findByText(/Getting your location/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send without location/i }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created[0].details).toEqual({ location_status: 'unavailable', emergency_type: 'other' });
  });

  it('on network failure: not registered, call fallback shown, retry reuses the same request id', async () => {
    mockGeolocation({ ok: false, code: 2 });
    let fail = true;
    serve(body => {
      if (fail) throw new ApiError(0, 'network', 'down');
      return { incident: incident(), duplicate: false, responder_accounts: 1 };
    });
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));
    expect(await screen.findByText('Not registered')).toBeInTheDocument();
    expect(screen.getByText(/The incident was not registered\. Nobody at TravelSphere has been told/)).toBeInTheDocument();
    expect(screen.getAllByText('Call emergency services').length).toBeGreaterThan(0);
    expect(screen.queryByText('Incident registered')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created).toHaveLength(2);
    expect(created[1].client_request_id).toBe(created[0].client_request_id);
  });

  it('a double tap sends one request', async () => {
    mockGeolocation({ ok: true, lat: 35.0, lon: 135.7 });
    let release!: () => void;
    serve(() => new Promise(r => { release = () => r({ incident: incident(), duplicate: false, responder_accounts: 1 }); }));
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    const btn = screen.getByRole('button', { name: /Register SOS with my location/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByText(/Creating incident/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is registered until it does/)).toBeInTheDocument();
    release();
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(created).toHaveLength(1);
  });

  it.each([
    [new ApiError(401, 'invalid_token', 'x'), /not signed in/],
    [new ApiError(400, 'validation_failed', 'x'), /rejected some of the details/],
    [new ApiError(429, 'rate_limited', 'x'), /Too many reports/],
    [new ApiError(500, 'internal', 'x'), /server had an error/],
  ])('explains %s without claiming success', async (err, text) => {
    mockGeolocation({ ok: false, code: 2 });
    serve(() => { throw err; });
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText('Not registered')).toBeInTheDocument();
  });

  it('offline: refuses immediately and offers calling', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mockGeolocation({ ok: false, code: 2 });
    serve();
    render(<SOSButton />);
    fireEvent.click(screen.getByRole('button', { name: /SOS: emergency options/i }));
    fireEvent.click(screen.getByRole('button', { name: /Register SOS with my location/i }));
    expect(await screen.findByText(/Your device is offline/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });
});

describe('emergency numbers', () => {
  it('every entry has digits, an https source and a check date; no country appears twice', () => {
    const codes = EMERGENCY_NUMBERS.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of EMERGENCY_NUMBERS) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.source.url).toMatch(/^https:\/\//);
      expect(c.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['verified', 'unconfirmed']).toContain(c.verification);
      expect(c.numbers.length).toBeGreaterThan(0);
      for (const n of c.numbers) expect(n.number).toMatch(/^\d{2,4}$/);
    }
    expect(numbersFor('fr')!.numbers.map(n => n.number)).toEqual(['112', '15', '17', '18']);
    expect(numbersFor('XX')).toBeNull();
    expect(telHref('+33 1 23')).toBe('tel:+33123');
  });

  it('shows verified numbers with their source', () => {
    localStorage.setItem('ts_emergency_country', JSON.stringify({ code: 'JP', source: 'manual', at: new Date().toISOString() }));
    render(<EmergencyCallPanel />);
    expect(screen.getByText('110').closest('a')).toHaveAttribute('href', 'tel:110');
    expect(screen.getByText('119')).toBeInTheDocument();
    expect(screen.getByText(/Checked against the official source on 2026-11-25/)).toBeInTheDocument();
    expect(screen.getByText(/chosen by you/)).toBeInTheDocument();
    expect(screen.getByText(/can’t tell whether the call connected/)).toBeInTheDocument();
  });

  it('flags unconfirmed numbers', () => {
    localStorage.setItem('ts_emergency_country', JSON.stringify({ code: 'IN', source: 'manual', at: new Date().toISOString() }));
    render(<EmergencyCallPanel />);
    expect(screen.getByText('112')).toBeInTheDocument();
    expect(screen.getByText(/Not yet confirmed/)).toBeInTheDocument();
  });

  it('never invents a number for a country outside the list, and lets the traveller choose', () => {
    localStorage.setItem('ts_emergency_country', JSON.stringify({ code: 'BR', source: 'location', at: '2026-11-20T10:00:00Z' }));
    const { container } = render(<EmergencyCallPanel />);
    expect(screen.getByText(/has no verified emergency number for Brazil/)).toBeInTheDocument();
    expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(0);
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose your country'), { target: { value: 'NZ' } });
    expect(screen.getByText('111')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ts_emergency_country')!)).toMatchObject({ code: 'NZ', source: 'manual' });
  });

  it('asks for the country when location fails', async () => {
    mockGeolocation({ ok: false, code: 1 });
    render(<EmergencyCallPanel />);
    expect(screen.getByText(/Country not known yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }));
    expect(await screen.findByText(/Location permission is blocked\. Choose your country below/)).toBeInTheDocument();
  });
});

describe('nearby facilities', () => {
  const facility = (over: Record<string, unknown>) => ({ osm_id: 'n1', kind: 'hospital', name: 'Hôpital A', latitude: 48.857,
    longitude: 2.352, distance_m: 420, phone: null, healthcare: 'hospital', has_emergency: null,
    retrieved_at: '2026-11-25T10:00:00Z', ...over });

  it('lists what OpenStreetMap has, without inventing phones or emergency departments', async () => {
    mockGeolocation({ ok: true, lat: 48.8566, lon: 2.3522 });
    api.mockResolvedValue({ facilities: [facility({}), facility({ osm_id: 'w2', kind: 'clinic', name: 'Clinique B', distance_m: 1500,
      phone: '+33 1 42 00 00 00' }), facility({ osm_id: 'n3', kind: 'police', name: null, distance_m: 900, healthcare: null })],
      radius_m: 5000, source: 'OpenStreetMap contributors, via the Overpass API', licence: 'ODbL 1.0', cached: false,
      country_code: 'FR', error: null });
    render(<NearbyResources />);
    fireEvent.click(screen.getByRole('button', { name: /Find nearby/i }));
    expect(await screen.findByText('Hôpital A')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/v1/emergency/resources', { method: 'POST', body: { latitude: 48.8566, longitude: 2.3522, radius_m: 5000 } });
    expect(screen.getByText(/Emergency department not recorded in the map data/)).toBeInTheDocument();
    expect(screen.getByText(/Not an emergency department unless confirmed/)).toBeInTheDocument();
    expect(screen.getByText('+33 1 42 00 00 00').closest('a')).toHaveAttribute('href', 'tel:+33142000000');
    expect(screen.getAllByText(/No phone number in the map data/)).toHaveLength(2);
    expect(screen.getByText('Unnamed police station')).toBeInTheDocument();
    expect(screen.getAllByText('Directions')[0].closest('a')).toHaveAttribute('href',
      'https://www.google.com/maps/dir/?api=1&destination=48.857,2.352');
    expect(screen.getByText(/Source: OpenStreetMap contributors/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Police' }));
    expect(screen.queryByText('Hôpital A')).not.toBeInTheDocument();
  });

  it('empty area: says nothing is mapped (not that nothing exists) and offers a wider search', async () => {
    mockGeolocation({ ok: true, lat: 64.1, lon: -21.9 });
    api.mockResolvedValue({ facilities: [], radius_m: 5000, source: 'OSM', licence: 'ODbL', cached: true, country_code: 'IS', error: null });
    render(<NearbyResources />);
    fireEvent.click(screen.getByRole('button', { name: /Find nearby/i }));
    expect(await screen.findByText(/No hospitals, clinics, police or fire stations are mapped/)).toBeInTheDocument();
    expect(screen.getByText(/doesn’t mean none exist/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Search a wider area/i }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/v1/emergency/resources', expect.objectContaining({
      body: expect.objectContaining({ radius_m: 10000 }) })));
  });

  it('a failed lookup is not presented as an empty area', async () => {
    mockGeolocation({ ok: true, lat: 35, lon: 135.7 });
    api.mockResolvedValue({ facilities: [], radius_m: 5000, source: 'OSM', licence: 'ODbL', cached: false, country_code: 'JP', error: 'busy' });
    render(<NearbyResources />);
    fireEvent.click(screen.getByRole('button', { name: /Find nearby/i }));
    expect(await screen.findByText(/lookup failed, so this is not a list of what’s nearby/)).toBeInTheDocument();
    expect(screen.queryByText(/are mapped/)).not.toBeInTheDocument();
  });

  it('location denied and server errors have retry states', async () => {
    mockGeolocation({ ok: false, code: 1 });
    render(<NearbyResources />);
    fireEvent.click(screen.getByRole('button', { name: /Find nearby/i }));
    expect(await screen.findByText(/Location permission is blocked/)).toBeInTheDocument();
    mockGeolocation({ ok: true, lat: 1, lon: 2 });
    api.mockRejectedValue(new ApiError(503, 'risk_service_unavailable', 'x'));
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(await screen.findByText(/facility lookup service is unavailable/)).toBeInTheDocument();
  });
});

describe('incident status', () => {
  it('wording only describes what the backend recorded', () => {
    expect(statusText({ status: 'open', assigned_to: null }).long).toMatch(/No responder has acknowledged it yet/);
    expect(statusText({ status: 'acknowledged', assigned_to: 'r1' }).long).toMatch(/assigned to a responder/);
    expect(responderText(0)).toMatch(/nobody at TravelSphere will see this/);
    expect(responderText(null)).toMatch(/could not check/);
    expect(classify(new ApiError(0, 'network', 'x'))).toBe('network');
  });

  it('the reporter sees status, history and responder notes', async () => {
    api.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/incidents/')) return { incident: { ...incident({ status: 'acknowledged', assigned_to: 'r9' }), updates: [
        { id: 'u1', author_id: 'r9', status: 'acknowledged', note: 'Calling you now', created_at: new Date().toISOString(), by_responder: true }] } };
      throw new Error(path);
    });
    render(<IncidentDetailView incidentId="22222222-2222-4222-8222-222222222222" onBack={vi.fn()} />);
    expect(await screen.findByText(/A TravelSphere responder has acknowledged it\. It is assigned to a responder\./)).toBeInTheDocument();
    expect(screen.getByText(/Calling you now/)).toBeInTheDocument();
    expect(screen.getByText('TravelSphere responder')).toBeInTheDocument();
    expect(screen.queryByText(/Responder actions/)).not.toBeInTheDocument();
  });

  it('responders get only the allowed transitions and can assign to themselves', async () => {
    const patches: any[] = [];
    api.mockImplementation(async (path: string, init?: { method?: string; body?: any }) => {
      if (init?.method === 'PATCH') { patches.push(init.body); return { incident: incident() }; }
      if (path.startsWith('/v1/incidents/')) return { incident: { ...incident(), updates: [] } };
      throw new Error(path);
    });
    render(<IncidentDetailView incidentId="22222222-2222-4222-8222-222222222222" onBack={vi.fn()} staff />);
    expect(await screen.findByText('Responder actions')).toBeInTheDocument();
    for (const label of ['Mark acknowledged', 'Mark responder working on it', 'Mark resolved', 'Mark closed']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /Assign to me \(and acknowledge\)/ }));
    await waitFor(() => expect(patches).toEqual([{ status: 'acknowledged', assigned_to: 'r1' }]));
    expect(await screen.findByText(/Status saved/)).toBeInTheDocument();
  });

  it('a missing or forbidden incident shows an error, not an empty page', async () => {
    api.mockRejectedValue(new ApiError(404, 'not_found', 'x'));
    render(<IncidentDetailView incidentId="22222222-2222-4222-8222-222222222222" onBack={vi.fn()} />);
    expect(await screen.findByText(/not found, or you don’t have access/)).toBeInTheDocument();
  });
});
