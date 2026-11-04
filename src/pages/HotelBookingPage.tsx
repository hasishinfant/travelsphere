import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HotelBookingWorkflow, HotelSearchForm, HotelSearchResults } from '../components/hotel';
import { hotelBookingService, HotelBookingSession } from '../services/hotelBookingService';
import type { HotelSearchResult, HotelResult } from '../services/hotelSearchService';
import { ArrowLeft, ShieldCheck, BadgePercent, Headphones } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Photo from '@/components/ui/Photo';
import { HOTEL_IMAGES } from '@/data/destinations';
import './HotelBookingPage.css';

const HotelBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<HotelBookingSession | null>(null);
  const [searchResults, setSearchResults] = useState<HotelSearchResult | null>(null);

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

  const handleHotelSelect = (hotel: HotelResult) => {
    if (searchResults) {
      // Start a booking session with the selected hotel
      const newSession = hotelBookingService.startBooking(
        hotel as any, // Type conversion needed - HotelResult vs Hotel type mismatch
        searchResults.searchCriteria
      );
      setSession(newSession);
      setSearchResults(null);
    }
  };

  const handleBookingComplete = (confirmationNumber: string) => {
    // Navigate to itinerary page with the booking confirmation
    navigate(`/itinerary?booking=${confirmationNumber}`);
  };

  const handleCancel = () => {
    hotelBookingService.cancelSession();
    setSession(null);
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
                <li><BadgePercent size={18} /><div><p>Member rates</p><span>Prices shown include taxes and fees.</span></div></li>
                <li><ShieldCheck size={18} /><div><p>Free cancellation</p><span>On most rooms, up to 24 h before check-in.</span></div></li>
                <li><Headphones size={18} /><div><p>24/7 support</p><span>Reach us any time from Emergency.</span></div></li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default HotelBookingPage;
