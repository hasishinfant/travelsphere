import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DayCard from './DayCard';
import type { ItineraryDay } from '@/types/itinerary';

describe('DayCard', () => {
  const mockDay: ItineraryDay = {
    dayNumber: 1,
    date: new Date('2024-01-15T00:00:00Z'),
    places: [
      {
        name: 'Central Park',
        description: 'Beautiful park in Manhattan',
        estimatedTime: '2 hours',
        category: 'Park',
      },
      {
        name: 'Metropolitan Museum',
        description: 'World-class art museum',
        estimatedTime: '3 hours',
        category: 'Museum',
      },
    ],
    foodRecommendations: [
      {
        name: "Joe's Pizza",
        type: 'Italian',
        description: 'Best pizza in NYC',
        priceRange: '$',
      },
    ],
    travelTips: [
      'Wear comfortable walking shoes',
      'Bring a water bottle',
    ],
  };

  it('renders day header with correct information', () => {
    render(<DayCard day={mockDay} />);
    
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/January/i)).toBeInTheDocument();
  });

  it('renders expand/collapse toggle with aria-expanded', () => {
    render(<DayCard day={mockDay} />);
    
    const headerButton = screen.getByRole('button');
    expect(headerButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles content visibility when header is clicked', () => {
    render(<DayCard day={mockDay} />);
    
    // Content should be visible initially
    expect(screen.getByText('Central Park')).toBeInTheDocument();
    
    // Click header to collapse
    const headerButton = screen.getByRole('button');
    fireEvent.click(headerButton);
    
    // Content should be hidden
    expect(screen.queryByText('Central Park')).not.toBeInTheDocument();
    expect(headerButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders all places with correct information', () => {
    render(<DayCard day={mockDay} />);
    
    expect(screen.getByText('Central Park')).toBeInTheDocument();
    expect(screen.getByText('Beautiful park in Manhattan')).toBeInTheDocument();
    expect(screen.getByText(/2 hours/)).toBeInTheDocument();
    expect(screen.getByText('Park')).toBeInTheDocument();
    
    expect(screen.getByText('Metropolitan Museum')).toBeInTheDocument();
    expect(screen.getByText('World-class art museum')).toBeInTheDocument();
    expect(screen.getByText(/3 hours/)).toBeInTheDocument();
    expect(screen.getByText('Museum')).toBeInTheDocument();
  });

  it('renders food recommendations with correct information', () => {
    render(<DayCard day={mockDay} />);
    
    expect(screen.getByText(/Where to eat/i)).toBeInTheDocument();
    expect(screen.getByText("Joe's Pizza")).toBeInTheDocument();
    expect(screen.getByText(/Best pizza in NYC/)).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('renders travel tips', () => {
    render(<DayCard day={mockDay} />);
    
    expect(screen.getByText(/Good to know/i)).toBeInTheDocument();
    expect(screen.getByText('Wear comfortable walking shoes')).toBeInTheDocument();
    expect(screen.getByText('Bring a water bottle')).toBeInTheDocument();
  });

  it('handles day with no places gracefully', () => {
    const dayWithoutPlaces = { ...mockDay, places: [] };
    render(<DayCard day={dayWithoutPlaces} />);
    
    expect(screen.queryByText('Central Park')).not.toBeInTheDocument();
    expect(screen.getByText(/Where to eat/i)).toBeInTheDocument();
    expect(screen.getByText(/Good to know/i)).toBeInTheDocument();
  });

  it('handles day with no food recommendations gracefully', () => {
    const dayWithoutFood = { ...mockDay, foodRecommendations: [] };
    render(<DayCard day={dayWithoutFood} />);
    
    expect(screen.getByText('Central Park')).toBeInTheDocument();
    expect(screen.queryByText(/Where to eat/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Good to know/i)).toBeInTheDocument();
  });

  it('handles day with no travel tips gracefully', () => {
    const dayWithoutTips = { ...mockDay, travelTips: [] };
    render(<DayCard day={dayWithoutTips} />);
    
    expect(screen.getByText('Central Park')).toBeInTheDocument();
    expect(screen.getByText(/Where to eat/i)).toBeInTheDocument();
    expect(screen.queryByText(/Good to know/i)).not.toBeInTheDocument();
  });

  it('applies correct CSS classes', () => {
    const { container } = render(<DayCard day={mockDay} />);
    
    expect(container.firstChild).toHaveClass('day-card', 'is-open');
    expect(screen.getByRole('button')).toHaveClass('day-header');
    expect(container.querySelector('.day-content')).toBeInTheDocument();
  });
});