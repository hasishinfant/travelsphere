/**
 * Hotel complaints kept on this device (localStorage).
 *
 * Nothing here is sent anywhere: not to TravelSphere's server, not to hotels. The UI says so.
 * Medical, lost-document, local-help and SOS reports go to the server instead (services/emergency.ts).
 */

export type EmergencyCategory = 'medical' | 'passport' | 'hotel' | 'local';

export type RequestStatus = 'submitted' | 'under_review' | 'in_progress' | 'resolved' | 'rejected';

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface StatusHistoryItem {
  status: RequestStatus;
  timestamp: string;
  note: string;
  agentName?: string;
}

export interface FollowUpMessage {
  id: string;
  sender: 'user' | 'support';
  senderName: string;
  message: string;
  timestamp: string;
}

export interface BaseEmergencyRecord {
  id: string;
  category: EmergencyCategory;
  categoryLabel: string;
  userId?: string;
  userName: string;
  userEmail: string;
  contactNumber: string;
  contactPreference: 'phone' | 'email' | 'whatsapp';
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  statusHistory: StatusHistoryItem[];
  followUpMessages: FollowUpMessage[];
}

export interface MedicalEmergencyRecord extends BaseEmergencyRecord {
  category: 'medical';
  assistanceType: 'injury' | 'illness' | 'prescription' | 'dental' | 'hospital_referral' | 'other';
  description: string;
  location: string;
  latitude?: number;
  longitude?: number;
  urgency: 'immediate' | 'within_2_hours' | 'within_24_hours';
  hasTravelInsurance: boolean;
  insuranceProvider?: string;
  medicalConditionsOrAllergies?: string;
}

export interface PassportEmergencyRecord extends BaseEmergencyRecord {
  category: 'passport';
  documentType: 'passport' | 'visa' | 'national_id' | 'driving_license' | 'boarding_pass';
  issuingCountry: string;
  incidentDate: string;
  incidentLocation: string;
  description: string;
  policeReportFiled: boolean;
  policeReportNumber?: string;
  upcomingDepartureDate?: string;
}

export interface HotelComplaintRecord extends BaseEmergencyRecord {
  category: 'hotel';
  hotelId: string;
  hotelName: string;
  hotelCity: string;
  hotelAddress?: string;
  isExternalHotel: boolean;
  bookingReference?: string;
  roomNumber?: string;
  checkInDate?: string;
  checkOutDate?: string;
  complaintCategory: 
    | 'booking_reservation'
    | 'room_cleanliness'
    | 'amenities_condition'
    | 'staff_service'
    | 'billing_charges'
    | 'cancellation_refund'
    | 'checkin_checkout'
    | 'safety_security'
    | 'other';
  complaintSubject: string;
  detailedDescription: string;
  severity: SeverityLevel;
  preferredResolution: 
    | 'refund_compensation'
    | 'room_change'
    | 'apology_explanation'
    | 'service_credit'
    | 'facility_repair'
    | 'other';
  attachments?: string[];
}

export interface LocalAssistanceRecord extends BaseEmergencyRecord {
  category: 'local';
  assistanceType: 'directions' | 'transportation' | 'translation' | 'safety' | 'lost_item' | 'other';
  location: string;
  latitude?: number;
  longitude?: number;
  description: string;
  urgency: 'high' | 'medium' | 'standard';
}

export type EmergencyComplaintRecord = 
  | MedicalEmergencyRecord 
  | PassportEmergencyRecord 
  | HotelComplaintRecord 
  | LocalAssistanceRecord;

export interface AvailableHotel {
  id: string;
  name: string;
  city: string;
  address?: string;
  starRating?: number;
  bookingReference?: string;
  checkIn?: string;
  checkOut?: string;
  isUserBooking?: boolean;
}

const STORAGE_KEY = 'travelsphere_emergency_complaints';

// Default catalog of hotels supported in TravelSphere
export const HOTEL_CATALOG: AvailableHotel[] = [
  {
    id: 'TAJ001',
    name: 'The Grand Palace Hotel',
    city: 'Mumbai',
    address: '123 Marine Drive, Colaba, Mumbai, India',
    starRating: 5,
  },
  {
    id: 'HYATT001',
    name: 'City Center Business Hotel',
    city: 'New Delhi',
    address: '456 MG Road, Connaught Place, New Delhi, India',
    starRating: 4,
  },
  {
    id: 'COMF001',
    name: 'Comfort Inn Express',
    city: 'Bengaluru',
    address: '78 Hosur Road, Koramangala, Bengaluru, India',
    starRating: 3,
  },
  {
    id: 'HERI001',
    name: 'Heritage Boutique Suites',
    city: 'Jaipur',
    address: '12 Amer Palace Road, Jaipur, India',
    starRating: 4,
  },
  {
    id: 'RESORT001',
    name: 'Tropical Paradise Resort & Spa',
    city: 'Goa',
    address: 'Sunset Beach Road, Calangute, Goa, India',
    starRating: 5,
  },
  {
    id: 'TRANS001',
    name: 'Airport Transit Hotel',
    city: 'Dubai',
    address: 'Terminal 3 Concourse B, Dubai, UAE',
    starRating: 3,
  },
];

// Demo tickets that earlier versions seeded into every browser (with invented coordinators and replies).
// They are removed from storage on read and never shown as real requests.
const LEGACY_DEMO_IDS = new Set(['TS-HTL-2026-7841', 'TS-MED-2026-3109']);

class EmergencyComplaintService {
  /**
   * Get all emergency and complaint records from localStorage
   */
  getStoredRequests(): EmergencyComplaintRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const all = JSON.parse(stored) as EmergencyComplaintRecord[];
      const real = all.filter(r => !LEGACY_DEMO_IDS.has(r.id));
      if (real.length !== all.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(real));
      return real;
    } catch {
      return [];
    }
  }

  /**
   * Save records to localStorage
   */
  private saveRequests(requests: EmergencyComplaintRecord[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('emergency-requests-updated'));
      }
    } catch (e) {
      console.error('Failed to save emergency requests to localStorage:', e);
    }
  }

  /**
   * Get request by unique reference ID
   */
  getRequestById(id: string): EmergencyComplaintRecord | undefined {
    const all = this.getStoredRequests();
    return all.find(r => r.id.toLowerCase() === id.toLowerCase());
  }

  /**
   * Get hotels associated with user bookings, combined with the general catalog
   */
  getAvailableHotels(): AvailableHotel[] {
    const hotelsMap = new Map<string, AvailableHotel>();

    // 1. Check user bookings from localStorage
    try {
      const storedBookings = localStorage.getItem('hotel_bookings');
      if (storedBookings) {
        const bookings = JSON.parse(storedBookings);
        if (Array.isArray(bookings)) {
          bookings.forEach((b: any, index: number) => {
            const hotelName = b.hotelName || b.hotel?.hotelName || `Hotel Booking #${index + 1}`;
            const hotelId = b.hotel?.hotelCode || b.bookingReferenceId || `BOOKED-${index}`;
            hotelsMap.set(hotelId, {
              id: hotelId,
              name: hotelName,
              city: b.hotel?.cityName || 'Booked Destination',
              address: b.hotel?.address,
              starRating: b.hotel?.starRating || 4,
              bookingReference: b.confirmationNumber || b.bookingReferenceId || `TS-HTL-${70000 + index}`,
              checkIn: b.checkIn ? new Date(b.checkIn).toISOString().split('T')[0] : '2026-11-01',
              checkOut: b.checkOut ? new Date(b.checkOut).toISOString().split('T')[0] : '2026-11-05',
              isUserBooking: true,
            });
          });
        }
      }
    } catch (e) {
      console.error('Error reading hotel bookings:', e);
    }

    // 2. Also check general bookings storage
    try {
      const generalBookings = localStorage.getItem('bookings');
      if (generalBookings) {
        const bookings = JSON.parse(generalBookings);
        if (Array.isArray(bookings)) {
          bookings.forEach((b: any, index: number) => {
            if (b.destination) {
              const id = `ITIN-HTL-${index}`;
              if (!hotelsMap.has(id)) {
                hotelsMap.set(id, {
                  id,
                  name: `Resort & Suites ${b.destination}`,
                  city: b.destination,
                  starRating: 4,
                  bookingReference: b.bookingId || `ITIN-${80000 + index}`,
                  checkIn: b.checkInDate || '2026-11-10',
                  checkOut: b.checkOutDate || '2026-11-15',
                  isUserBooking: true,
                });
              }
            }
          });
        }
      }
    } catch (e) {
      console.error('Error reading itinerary bookings:', e);
    }

    // 3. If no user bookings yet, add 2 sample active user bookings so multi-hotel selector works out of the box
    if (hotelsMap.size === 0) {
      hotelsMap.set('TAJ001', {
        id: 'TAJ001',
        name: 'The Grand Palace Hotel',
        city: 'Mumbai',
        address: '123 Marine Drive, Colaba, Mumbai, India',
        starRating: 5,
        bookingReference: 'TS-HTL-77412',
        checkIn: '2026-11-01',
        checkOut: '2026-11-05',
        isUserBooking: true,
      });
      hotelsMap.set('HYATT001', {
        id: 'HYATT001',
        name: 'City Center Business Hotel',
        city: 'New Delhi',
        address: '456 MG Road, Connaught Place, New Delhi, India',
        starRating: 4,
        bookingReference: 'TS-HTL-89210',
        checkIn: '2026-11-12',
        checkOut: '2026-11-16',
        isUserBooking: true,
      });
    }

    // 4. Merge in general catalog hotels (flagged as non-user bookings)
    HOTEL_CATALOG.forEach(catHotel => {
      if (!hotelsMap.has(catHotel.id)) {
        hotelsMap.set(catHotel.id, {
          ...catHotel,
          isUserBooking: false,
        });
      }
    });

    return Array.from(hotelsMap.values());
  }

  /**
   * Helper to generate human-readable reference IDs
   */
  private generateReferenceId(prefix: string): string {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    return `TS-${prefix}-${new Date().getFullYear()}-${randomDigits}`;
  }

  /**
   * Helper to get active user details
   */
  private getActiveUserDetails() {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const user = JSON.parse(stored);
        return {
          userName: user.name || 'Traveler',
          userEmail: user.email || 'traveler@travelsphere.com',
        };
      }
    } catch (e) {
      // fallback
    }
    return {
      userName: 'Demo Traveler',
      userEmail: 'demo@travelsphere.com',
    };
  }

  /**
   * Submit Hotel Complaint
   */
  async submitHotelComplaint(data: Omit<HotelComplaintRecord, 'id' | 'category' | 'categoryLabel' | 'createdAt' | 'updatedAt' | 'status' | 'statusHistory' | 'followUpMessages' | 'userName' | 'userEmail'>): Promise<HotelComplaintRecord> {
    const now = new Date().toISOString();
    const userInfo = this.getActiveUserDetails();
    const id = this.generateReferenceId('HTL');

    const newRecord: HotelComplaintRecord = {
      ...data,
      id,
      category: 'hotel',
      categoryLabel: 'Hotel & Accommodation Issue',
      userName: userInfo.userName,
      userEmail: userInfo.userEmail,
      createdAt: now,
      updatedAt: now,
      status: 'submitted',
      statusHistory: [
        {
          status: 'submitted',
          timestamp: now,
          note: `Complaint about ${data.hotelName}${data.bookingReference ? ` (booking ${data.bookingReference})` : ''} saved on this device. It has not been sent to the hotel or to TravelSphere.`,
        },
      ],
      followUpMessages: [],
    };

    const requests = this.getStoredRequests();
    requests.unshift(newRecord);
    this.saveRequests(requests);

    return newRecord;
  }

  /**
   * Add a follow-up message to an existing ticket
   */
  async addFollowUpMessage(requestId: string, messageText: string, senderName: string = 'You'): Promise<EmergencyComplaintRecord> {
    const requests = this.getStoredRequests();
    const index = requests.findIndex(r => r.id.toLowerCase() === requestId.toLowerCase());

    if (index === -1) {
      throw new Error(`Request with ID ${requestId} not found.`);
    }

    const now = new Date().toISOString();
    const newMsg: FollowUpMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      senderName,
      message: messageText,
      timestamp: now,
    };

    requests[index].followUpMessages.push(newMsg);
    requests[index].updatedAt = now;

    this.saveRequests(requests);
    return requests[index];
  }

  /**
   * Update request status and record in statusHistory
   */
  async updateRequestStatus(
    requestId: string,
    newStatus: RequestStatus,
    note?: string,
    agentName?: string
  ): Promise<EmergencyComplaintRecord> {
    const requests = this.getStoredRequests();
    const index = requests.findIndex(r => r.id.toLowerCase() === requestId.toLowerCase());

    if (index === -1) {
      throw new Error(`Request with ID ${requestId} not found.`);
    }

    const now = new Date().toISOString();
    requests[index].status = newStatus;
    requests[index].updatedAt = now;

    if (!requests[index].statusHistory) {
      requests[index].statusHistory = [];
    }

    requests[index].statusHistory.push({
      status: newStatus,
      timestamp: now,
      note: note || `Status updated to ${newStatus.replace('_', ' ').toUpperCase()}`,
      agentName,
    });

    this.saveRequests(requests);
    return requests[index];
  }
}

export const complaintService = new EmergencyComplaintService();
