import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookingDetailsView, BookingList, HotelBookingWorkflow, HotelDetailsModal, HotelSearchForm, HotelSearchResults,
} from '../components/hotel';
import { hotelBookingService, HotelBookingSession } from '../services/hotelBookingService';
import type { HotelSearchResult, HotelResult } from '../services/hotelSearchService';
import { getSession } from '../services/apiClient';
import { ArrowLeft, ShieldCheck, BadgePercent, ClipboardList } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Photo from '@/components/ui/Photo';
import { HOTEL_IMAGES } from '@/data/destinations';
import './HotelBookingPage.css';

const HotelBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<HotelBookingSession | null>(null);
  const [searchResults, setSearchResults] = useState<HotelSearchResult | null>(null);
  const [viewing, setViewing] = useState<HotelResult | null>(null);
  const [openBooking, setOpenBooking] = useState<string | null>(null);
  const [bookingsKey, setBookingsKey] = useState(0);
  const signedIn = !!getSession();

  useEffect(() => {
    // Check if there's an active booking session
    const activeSession = hotelBookingService.getCurrentSession();
    if (activeSession) {
      setSession(activeSession);
    }
  }, []);

  const handleSearchComplete = (results: HotelSearchResult) => {
    setSearchResults(results);
  };

  // "View details" opens the hotel with its rooms; "Book now" starts the booking with the chosen room
  const handleHotelSelect = (hotel: HotelResult) => setViewing(hotel);

  // The traveller has already seen the hotel and chosen a room in the details panel, so the booking starts at
  // price verification rather than showing the same details again.
  const handleBookNow = (hotel: HotelResult) => {
    if (!searchResults) return;
    hotelBookingService.startBooking(hotel, searchResults.searchCriteria);
    hotelBookingService.updateSession({ status: 'prebook' });
    setSession(hotelBookingService.getCurrentSession());
    setViewing(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBookingComplete = (confirmationNumber: string) => {
    // Navigate to itinerary page with the booking confirmation
    navigate(`/itinerary?booking=${confirmationNumber}`);
  };

  const handleCancel = () => {
    hotelBookingService.cancelSession();
    setSession(null);
    setBookingsKey(k => k + 1); // a booking may have just been made
  };

  const handleBackToSearch = () => {
    setSearchResults(null);
  };

  return (
    <div className="page hotel-booking-page">
      <PageHeader
        title="Hotels"
        subtitle="Search live availability and book a room for your trip."
        actions={searchResults && !session ? (
          <button type="button" className="btn btn-secondary back-button" onClick={handleBackToSearch}>
            <ArrowLeft size={16} /> Back to search
          </button>
        ) : undefined}
      />

      {session ? (
        <HotelBookingWorkflow
          session={session}
          sandbox={searchResults?.sandbox ?? true}
          onComplete={handleBookingComplete}
          onCancel={handleCancel}
        />
      ) : searchResults ? (
        <HotelSearchResults
          searchResult={searchResults}
          onHotelSelect={handleHotelSelect}
        />
      ) : (
        <div className="hotel-search-layout">
          <HotelSearchForm onSearchComplete={handleSearchComplete} />
          <aside className="hotel-search-side">
            <div className="surface hotel-side-card">
              <Photo src={HOTEL_IMAGES[0]} alt="Hotel pool deck with loungers" width={320} ratio="4 / 3" priority />
              <ul className="hotel-perks">
                <li><BadgePercent size={18} /><div><p>Live rates</p><span>Prices for your whole stay, checked again before you book.</span></div></li>
                <li><ShieldCheck size={18} /><div><p>Clear terms</p><span>Cancellation terms are shown for every room before you pay.</span></div></li>
                <li><ClipboardList size={18} /><div><p>Manage bookings</p><span>View or cancel your stays below.</span></div></li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {viewing && (
        <HotelDetailsModal hotel={viewing} isOpen onClose={() => setViewing(null)} onBookNow={handleBookNow} />
      )}

      {!session && !searchResults && signedIn && (
        <section className="hotel-bookings-section">
          <h2 className="section-title">Your hotel bookings</h2>
          {openBooking ? (
            <BookingDetailsView
              confirmationNumber={openBooking}
              onClose={() => setOpenBooking(null)}
              onCancellationComplete={() => setBookingsKey(k => k + 1)}
            />
          ) : (
            <BookingList key={bookingsKey} onViewDetails={setOpenBooking} onCancelBooking={setOpenBooking} />
          )}
        </section>
      )}
    </div>
  );
};

export default HotelBookingPage;
