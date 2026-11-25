// Emergency support UI: forms register real server incidents, wording never claims help was dispatched,
// and hotel complaints are clearly kept on this device only.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.fn();
const ensureSession = vi.fn(async () => true);
vi.mock('@/services/apiClient', async importActual => ({
  ...(await importActual<typeof import('@/services/apiClient')>()),
  api: (...a: unknown[]) => api(...a),
  ensureSession: () => ensureSession(),
  getSession: () => ({ token: 't', userId: 'u1', mode: 'local-dev' }),
}));

import { ApiError } from '@/services/apiClient';
import { EmergencyLandingView } from '../../components/emergency/EmergencyLandingView';
import { HotelComplaintView } from '../../components/emergency/HotelComplaintView';
import { MedicalEmergencyView } from '../../components/emergency/MedicalEmergencyView';
import { LostPassportView } from '../../components/emergency/LostPassportView';
import { LocalAssistanceView } from '../../components/emergency/LocalAssistanceView';
import { ComplaintHistoryView } from '../../components/emergency/ComplaintHistoryView';
import { ComplaintDetailView } from '../../components/emergency/ComplaintDetailView';
import { complaintService } from '../../services/complaintService';

const FORBIDDEN = /help is on the way|dispatched|coordinator has|concierge team|liaison (team|desk)|specialist will|within 15 minutes|24\/7|around the clock/i;

const incident = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', reference: 'INC-ABCD1234', reporter_id: 'u1', category: 'medical',
  priority: 'normal', status: 'open', title: 'x', description: 'x', latitude: null, longitude: null, location_accuracy_m: null,
  occurred_at: new Date().toISOString(), is_sos: false, verified: false, assigned_to: null, details: {},
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
});

/** Route the mocked API by path: incident creation, lists, profile and country lookups. */
function serve(create: (body: any) => unknown = body => ({ incident: incident({ category: body.category }), duplicate: false, responder_accounts: 2 })) {
  api.mockImplementation(async (path: string, init?: { method?: string; body?: any }) => {
    if (path === '/v1/incidents' && init?.method === 'POST') return create(init.body);
    if (path.startsWith('/v1/incidents?')) return { incidents: [] };
    if (path === '/profile') return { profile: { id: 'u1', role: 'traveller' } };
    if (path === '/v1/emergency/country') return { country_code: null };
    throw new Error(`unexpected ${path}`);
  });
}

describe('Emergency support UI', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ name: 'Traveller', email: 't@example.test' }));
    api.mockReset();
    ensureSession.mockReset().mockResolvedValue(true);
    serve();
  });

  it('landing shows the call panel, the four categories and no invented hotline or response promises', async () => {
    const onSelectCategory = vi.fn();
    const { container } = render(<MemoryRouter><EmergencyLandingView onSelectCategory={onSelectCategory}
      onViewHistory={vi.fn()} onViewRequestDetail={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Life-threatening emergency\?/)).toBeInTheDocument();
    expect(screen.getAllByText('Call emergency services').length).toBeGreaterThan(0);
    for (const t of ['Medical Emergency', 'Lost Passport & Documents', 'Hotel & Accommodation Issue', 'Local Travel Assistance']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(container.textContent).not.toMatch(/555-SAFE|15-Minute/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getByText(/Doesn’t dispatch help/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hotel & Accommodation Issue').closest('.category-assistance-card')!);
    expect(onSelectCategory).toHaveBeenCalledWith('hotel');
    await screen.findByText(/You haven’t registered any incidents/);
  });

  it('medical form validates, then registers a server incident with its details', async () => {
    const onSuccessTrack = vi.fn();
    let sent: any;
    serve(body => { sent = body; return { incident: incident({ category: 'medical', priority: 'high' }), duplicate: false, responder_accounts: 1 }; });
    render(<MemoryRouter><MedicalEmergencyView onBack={vi.fn()} onSuccessTrack={onSuccessTrack} /></MemoryRouter>);

    const submit = screen.getByRole('button', { name: /Register medical request/i });
    fireEvent.click(submit);
    expect(screen.getByText(/Please describe the symptoms/i)).toBeInTheDocument();
    expect(screen.getByText(/Contact phone number is required/i)).toBeInTheDocument(); // no pre-filled fake number
    expect(api).not.toHaveBeenCalledWith('/v1/incidents', expect.anything());

    fireEvent.change(screen.getByPlaceholderText(/Please provide details of current symptoms/i),
      { target: { value: 'Sudden high fever and vomiting after dinner.' } });
    fireEvent.change(screen.getByPlaceholderText(/e.g., Room 402/i), { target: { value: 'Hotel Artemide, Rome' } });
    fireEvent.change(screen.getByLabelText(/Direct Contact Phone Number/i), { target: { value: '+39 333 123 4567' } });
    fireEvent.click(submit);

    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(screen.getByText('INC-ABCD1234')).toBeInTheDocument();
    expect(screen.getByText(/No responder has acknowledged it yet/)).toBeInTheDocument();
    expect(screen.getByText(/1 TravelSphere responder account can see it/)).toBeInTheDocument();
    expect(sent).toMatchObject({ category: 'medical', title: 'Medical: Illness', details: {
      assistance_type: 'illness', urgency: 'within_2_hours', location_text: 'Hotel Artemide, Rome', location_status: 'manual',
      contact_number: '+39 333 123 4567' } });
    expect(sent.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    fireEvent.click(screen.getByRole('button', { name: /View status and updates/i }));
    expect(onSuccessTrack).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('a failed medical submission keeps the form, says it was not registered and retries with the same request id', async () => {
    const ids: string[] = [];
    let fail = true;
    serve(body => {
      ids.push(body.client_request_id);
      if (fail) throw new ApiError(0, 'network', 'down');
      return { incident: incident(), duplicate: true, responder_accounts: 0 };
    });
    render(<MemoryRouter><MedicalEmergencyView onBack={vi.fn()} onSuccessTrack={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Please provide details of current symptoms/i),
      { target: { value: 'Deep cut on my hand, bleeding a lot.' } });
    fireEvent.change(screen.getByPlaceholderText(/e.g., Room 402/i), { target: { value: 'Shinjuku station' } });
    fireEvent.change(screen.getByLabelText(/Direct Contact Phone Number/i), { target: { value: '+81 90 1234 5678' } });
    fireEvent.click(screen.getByRole('button', { name: /Register medical request/i }));

    expect(await screen.findByText('Not registered')).toBeInTheDocument();
    expect(screen.getByText(/server could not be reached. The incident was not registered/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody at TravelSphere has been told/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Shinjuku station')).toBeInTheDocument(); // nothing lost

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    // The server reports zero responder accounts → the traveller is told nobody will see it
    expect(screen.getByText(/nobody at TravelSphere will see this/)).toBeInTheDocument();
  });

  it('lost-document report registers a lost_documents incident and gives self-help steps, not embassy claims', async () => {
    let sent: any;
    serve(body => { sent = body; return { incident: incident({ category: 'lost_documents' }), duplicate: false, responder_accounts: 1 }; });
    render(<MemoryRouter><LostPassportView onBack={vi.fn()} onSuccessTrack={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/e.g., United States, United Kingdom/i), { target: { value: 'United Kingdom' } });
    fireEvent.change(screen.getByPlaceholderText(/Terminal 2, Heathrow Airport/i), { target: { value: 'Gare du Nord, Paris' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe where the documents were last seen/i),
      { target: { value: 'Passport pouch taken from my bag on the train.' } });
    fireEvent.change(screen.getByLabelText(/Contact/i, { selector: 'input[type="tel"]' }), { target: { value: '+44 7700 900123' } });
    fireEvent.click(screen.getByRole('button', { name: /Register lost-document report/i }));

    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(screen.getByText(/TravelSphere does not contact embassies for you/)).toBeInTheDocument();
    expect(sent).toMatchObject({ category: 'lost_documents', details: { document_type: 'passport', issuing_country: 'United Kingdom',
      police_report_filed: false } });
    expect(document.body.textContent).not.toMatch(/Consular Case Initiated|consular liaison/i);
  });

  it('local-help request registers an assistance incident', async () => {
    let sent: any;
    serve(body => { sent = body; return { incident: incident({ category: 'assistance' }), duplicate: false, responder_accounts: 3 }; });
    render(<MemoryRouter><LocalAssistanceView onBack={vi.fn()} onSuccessTrack={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Near Tokyo Station/i), { target: { value: 'Alexanderplatz, Berlin' } });
    fireEvent.change(screen.getByPlaceholderText(/Provide context, names of transport stations/i),
      { target: { value: 'Train strike cancelled the service to the airport.' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \/ WhatsApp/i), { target: { value: '+49 151 2345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Register local-help request/i }));
    expect(await screen.findByText('Incident registered')).toBeInTheDocument();
    expect(sent).toMatchObject({ category: 'assistance', title: 'Local help: transport', details: { assistance_type: 'transportation' } });
    expect(document.body.textContent).not.toMatch(/Concierge Request Queued/);
  });

  it('when the traveller has no server session, nothing is registered and calling is offered', async () => {
    ensureSession.mockResolvedValue(false);
    render(<MemoryRouter><LocalAssistanceView onBack={vi.fn()} onSuccessTrack={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Near Tokyo Station/i), { target: { value: 'Ubud, Bali' } });
    fireEvent.change(screen.getByPlaceholderText(/Provide context, names of transport stations/i),
      { target: { value: 'Need a translator at the clinic.' } });
    fireEvent.change(screen.getByLabelText(/Phone Number \/ WhatsApp/i), { target: { value: '+62 812 3456 789' } });
    fireEvent.click(screen.getByRole('button', { name: /Register local-help request/i }));
    expect(await screen.findByText(/You are not signed in to TravelSphere/)).toBeInTheDocument();
    expect(screen.getAllByText('Call emergency services').length).toBeGreaterThan(0);
    expect(api).not.toHaveBeenCalledWith('/v1/incidents', expect.anything());
  });

  it('hotel complaint is saved on this device and says it was not sent to the hotel', async () => {
    const onSuccessTrack = vi.fn();
    render(<MemoryRouter><HotelComplaintView onBack={vi.fn()} onSuccessTrack={onSuccessTrack} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/AC unit leaking water and room uncleaned/i), { target: { value: 'AC not working' } });
    fireEvent.change(screen.getByPlaceholderText(/Please provide full details including times/i),
      { target: { value: 'The air conditioner blows hot air and the room was not cleaned.' } });
    fireEvent.click(screen.getByRole('button', { name: /Save complaint on this device/i }));
    expect(await screen.findByText(/Complaint saved on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/has/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/not.*been sent to the hotel or to TravelSphere/);
    expect(document.body.textContent).not.toMatch(/Officially Registered|Liaison Desk/);
    fireEvent.click(screen.getByRole('button', { name: /Open saved complaint/i }));
    expect(onSuccessTrack).toHaveBeenCalled();
  }, 15000);

  it('history and detail of device-only complaints are labelled as such, with no simulated replies', async () => {
    const record = await complaintService.submitHotelComplaint({
      hotelId: 'TAJ001', hotelName: 'The Grand Palace Hotel', hotelCity: 'Mumbai', isExternalHotel: false,
      complaintCategory: 'staff_service', complaintSubject: 'Front desk billing discrepancy',
      detailedDescription: 'Double charged for airport shuttle.', severity: 'medium', preferredResolution: 'refund_compensation',
      contactNumber: '', contactPreference: 'phone',
    });
    const { unmount } = render(<MemoryRouter><ComplaintHistoryView onBack={vi.fn()} onSelectRequest={vi.fn()} onNewRequest={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Saved on this device')).toBeInTheDocument();
    expect(screen.getByText(/never sent to TravelSphere, a hotel or anyone else/)).toBeInTheDocument();
    unmount();

    render(<MemoryRouter><ComplaintDetailView requestId={record.id} onBack={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Saved on this device only/)).toBeInTheDocument();
    expect(screen.queryByText(/Live Channel/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Add a note for your own record/i), { target: { value: 'Manager refunded the charge.' } });
    fireEvent.click(screen.getByTitle('Save note'));
    expect(await screen.findByText('Manager refunded the charge.')).toBeInTheDocument();
    expect(screen.getByText(/Note saved on this device/)).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 1500));
    expect(complaintService.getRequestById(record.id)!.followUpMessages.every(m => m.sender === 'user')).toBe(true);
  });
});
