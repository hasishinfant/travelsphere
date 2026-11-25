import { describe, it, expect, beforeEach } from 'vitest';
import { complaintService } from '../../services/complaintService';

const hotelComplaint = () => complaintService.submitHotelComplaint({
  hotelId: 'TAJ001', hotelName: 'The Grand Palace Hotel', hotelCity: 'Mumbai', isExternalHotel: false,
  bookingReference: 'TS-HTL-77412', roomNumber: '402', complaintCategory: 'room_cleanliness',
  complaintSubject: 'Dirty bathroom upon check-in', detailedDescription: 'The bathroom was not cleaned and towels were missing.',
  severity: 'medium', preferredResolution: 'room_change', contactNumber: '', contactPreference: 'phone',
});

describe('Hotel complaints kept on this device', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty: no demo tickets are seeded', () => {
    expect(complaintService.getStoredRequests()).toEqual([]);
  });

  it('removes demo tickets that older versions seeded', () => {
    localStorage.setItem('travelsphere_emergency_complaints', JSON.stringify([
      { id: 'TS-HTL-2026-7841', category: 'hotel' }, { id: 'TS-MED-2026-3109', category: 'medical' }, { id: 'TS-HTL-2026-1111', category: 'hotel' },
    ]));
    expect(complaintService.getStoredRequests().map(r => r.id)).toEqual(['TS-HTL-2026-1111']);
    expect(JSON.parse(localStorage.getItem('travelsphere_emergency_complaints')!)).toHaveLength(1);
  });

  it('provides hotels to choose from', () => {
    const hotels = complaintService.getAvailableHotels();
    expect(hotels.length).toBeGreaterThan(0);
    expect(hotels[0]).toHaveProperty('name');
  });

  it('saves a complaint with an honest history and no invented replies', async () => {
    const c = await hotelComplaint();
    expect(c.id).toMatch(/^TS-HTL-\d{4}-\d{4}$/);
    expect(c.followUpMessages).toEqual([]);
    expect(c.statusHistory[0].note).toMatch(/saved on this device\. It has not been sent to the hotel or to TravelSphere/);
    expect(complaintService.getRequestById(c.id)?.id).toBe(c.id);
  });

  it('notes are the traveller’s own; nothing answers them', async () => {
    const c = await hotelComplaint();
    const updated = await complaintService.addFollowUpMessage(c.id, 'Hotel moved me to another room.');
    expect(updated.followUpMessages).toHaveLength(1);
    await new Promise(r => setTimeout(r, 1500)); // the old version posted a fake "Support Officer" reply after 1.2 s
    expect(complaintService.getRequestById(c.id)!.followUpMessages).toHaveLength(1);
  });

  it('the traveller can mark their own record resolved', async () => {
    const c = await hotelComplaint();
    const updated = await complaintService.updateRequestStatus(c.id, 'resolved', 'Refund received.');
    expect(updated.status).toBe('resolved');
    expect(updated.statusHistory[1]).toMatchObject({ status: 'resolved', note: 'Refund received.' });
    expect(updated.statusHistory[1].agentName).toBeUndefined();
  });
});
