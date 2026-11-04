import React from 'react';
import TripPlannerForm from '../components/trip-planner/TripPlannerForm';
import PageHeader from '@/components/ui/PageHeader';

const TripPlannerPage: React.FC = () => (
  <div className="page">
    <PageHeader
      title="Plan a trip"
      subtitle="Tell us where and when. We’ll build a day-by-day itinerary around what you love."
    />
    <TripPlannerForm />
  </div>
);

export default TripPlannerPage;
