// Comprehensive mock data service for API fallbacks
import type { TripPlannerFormData } from '@/types/trip';
import type { ItineraryResponse, ChatResponse, EmergencyResponse, EmergencyType, ApiResponse } from '@/types/api';

import { DESTINATIONS, getDestination, mapEmbedUrl, type DestinationRecord, type BudgetTier } from '@/data/destinations';

// Destination catalogue (derived from the single source of truth in src/data/destinations.ts)
export const MOCK_DESTINATIONS = DESTINATIONS.map(d => ({
  id: d.id,
  name: d.name,
  description: d.description,
  imageUrl: d.imageUrl,
  vrPreviewUrl: mapEmbedUrl(d),
  popularityScore: d.popularityScore,
  category: d.category,
  highlights: d.highlights,
  bestTimeToVisit: d.bestTimeToVisit,
  averageCost: d.averageCost,
}));

// Itinerary generation
export function generateMockItinerary(formData: TripPlannerFormData): ApiResponse<ItineraryResponse> {
  const tripDuration = Math.max(
    1,
    Math.ceil((formData.endDate.getTime() - formData.startDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const destination = getDestination(formData.destination) || DESTINATIONS[0];
  const budget = (formData.budget || 'medium') as BudgetTier;
  // Inclusive of arrival and departure days: 14 → 18 Dec is 5 days / 4 nights
  const days = Math.min(tripDuration + 1, 14);

  const mockItinerary: ItineraryResponse = {
    tripId: `trip-${Date.now()}`,
    itinerary: Array.from({ length: days }, (_, index) => {
      const currentDate = new Date(formData.startDate);
      currentDate.setDate(currentDate.getDate() + index);
      return {
        dayNumber: index + 1,
        date: currentDate,
        places: generateDayPlaces(destination, index, formData.interests || []),
        foodRecommendations: generateFoodRecommendations(destination, budget, index),
        travelTips: generateTravelTips(destination, index, budget, formData.interests || []),
      };
    }),
    estimatedCost: {
      min: Math.round(destination.averageCost[budget] * tripDuration * 0.8),
      max: Math.round(destination.averageCost[budget] * tripDuration * 1.2),
      currency: 'USD',
    },
    generatedAt: new Date(),
  };

  return { success: true, data: mockItinerary, timestamp: new Date() };
}

// Two places per day. Places matching the traveller's interests come first,
// and the list wraps so long trips never produce empty days.
function generateDayPlaces(destination: DestinationRecord, dayIndex: number, interests: string[]) {
  const wanted = new Set(interests.map(i => i.toLowerCase()));
  const ranked = [
    ...destination.places.filter(p => wanted.has(p.category)),
    ...destination.places.filter(p => !wanted.has(p.category)),
  ];
  const perDay = 2;
  return Array.from({ length: perDay }, (_, k) => ranked[(dayIndex * perDay + k) % ranked.length]).map(place => ({
    name: place.name,
    description: place.description,
    estimatedTime: place.time,
    category: place.category,
  }));
}

function generateFoodRecommendations(destination: DestinationRecord, budget: BudgetTier, dayIndex = 0) {
  const tiers: BudgetTier[] = ['low', 'medium', 'luxury'];
  const primary = destination.food[budget] || destination.food.medium;
  // Rotate in one pick from a neighbouring tier on alternate days for variety
  const alt = destination.food[tiers[(tiers.indexOf(budget) + 1) % 3]];
  return dayIndex % 2 === 0 ? primary : [primary[1] || primary[0], alt[0]];
}

function generateTravelTips(destination: DestinationRecord, dayIndex: number, budget: BudgetTier, interests: string[]) {
  const baseTips = [
    'Start early to beat the crowds at headline sights',
    'Wear comfortable walking shoes',
    'Carry a portable charger and offline maps',
    'Keep digital copies of your passport and bookings',
  ];
  const budgetTips: Record<BudgetTier, string> = {
    low: 'Look for free walking tours and eat where locals queue',
    medium: 'Book timed-entry tickets in advance for better prices',
    luxury: 'Reserve high-end restaurants several weeks ahead',
  };
  const interestTips: Record<string, string> = {
    food: 'Ask your host for their favourite neighbourhood spot',
    culture: 'Visit museums right at opening for quieter galleries',
    nature: 'Check the forecast before outdoor excursions',
    adventure: 'Make sure your insurance covers adventure activities',
    shopping: 'Keep receipts to claim tax refunds at the airport',
  };
  const tips = [
    destination.tips[dayIndex % destination.tips.length],
    baseTips[dayIndex % baseTips.length],
    budgetTips[budget],
  ];
  const interestTip = interests.map(i => interestTips[i]).find(Boolean);
  if (interestTip && dayIndex % 2 === 1) tips[2] = interestTip;
  return tips;
}

// Enhanced mock chat responses
export function generateMockChatResponse(message: string): ApiResponse<ChatResponse> {
  const lowerMessage = message.toLowerCase();
  
  let response = '';
  let suggestions: string[] = [];

  if (lowerMessage.includes('food') || lowerMessage.includes('eat') || lowerMessage.includes('restaurant')) {
    response = "For food recommendations, I'd suggest trying the local specialties! Each destination has unique flavors - from French pastries in Paris to fresh sushi in Tokyo. Would you like specific restaurant suggestions based on your budget?";
    suggestions = ['Recommend budget-friendly restaurants', 'What are the local specialties?', 'Any food markets nearby?'];
  } else if (lowerMessage.includes('transport') || lowerMessage.includes('get around') || lowerMessage.includes('travel')) {
    response = "Getting around is easy with local transportation! Most cities have efficient public transit systems. I can help you with metro maps, taxi apps, or walking routes to your destinations.";
    suggestions = ['Show me public transport options', 'How much do taxis cost?', 'Is it walkable?'];
  } else if (lowerMessage.includes('hidden') || lowerMessage.includes('secret') || lowerMessage.includes('gems')) {
    response = "I love sharing hidden gems! There are amazing local spots that most tourists miss - from secret viewpoints to neighborhood cafés where locals hang out. What type of hidden gems interest you most?";
    suggestions = ['Secret viewpoints', 'Local neighborhood spots', 'Off-the-beaten-path attractions'];
  } else if (lowerMessage.includes('weather') || lowerMessage.includes('climate')) {
    response = "Weather can really impact your trip! I can help you prepare with current conditions, seasonal patterns, and what to pack. The best time to visit varies by destination and your preferred activities.";
    suggestions = ['What should I pack?', 'Best time to visit?', 'Current weather conditions'];
  } else if (lowerMessage.includes('culture') || lowerMessage.includes('customs') || lowerMessage.includes('etiquette')) {
    response = "Understanding local culture enhances your travel experience! Each destination has unique customs, from greeting styles to dining etiquette. I can share important cultural tips to help you connect with locals respectfully.";
    suggestions = ['Greeting customs', 'Dining etiquette', 'What to avoid doing'];
  } else if (lowerMessage.includes('attraction') || lowerMessage.includes('see') || lowerMessage.includes('visit')) {
    response = "There are so many amazing attractions to explore! From world-famous landmarks to local favorites, I can help you prioritize based on your interests and available time. What type of attractions interest you most?";
    suggestions = ['Must-see landmarks', 'Museums and galleries', 'Outdoor activities'];
  } else if (lowerMessage.includes('budget') || lowerMessage.includes('cost') || lowerMessage.includes('price')) {
    response = "Budget planning is crucial for a great trip! Costs vary significantly by destination and travel style. I can help you estimate expenses for accommodation, food, transportation, and activities based on your preferences.";
    suggestions = ['Daily budget estimates', 'Money-saving tips', 'Free activities'];
  } else if (lowerMessage.includes('safety') || lowerMessage.includes('safe') || lowerMessage.includes('security')) {
    response = "Your safety is important! I can share current safety information, common scams to avoid, emergency contacts, and general precautions for your destination. Most popular tourist areas are quite safe with basic precautions.";
    suggestions = ['Emergency contacts', 'Common scams to avoid', 'Safe neighborhoods'];
  } else {
    const generalResponses = [
      "I'm here to help make your trip amazing! What specific aspect of your travel would you like assistance with?",
      "Great question! I have lots of local insights to share. What would you like to know more about?",
      "I'd be happy to help you with your travel plans! Could you tell me more about what you're looking for?",
      "That's an interesting question! Let me provide you with some helpful information and suggestions.",
    ];
    
    response = generalResponses[Math.floor(Math.random() * generalResponses.length)];
    suggestions = [
      'Tell me about local food',
      'How do I get around?',
      'What are the must-see attractions?',
      'Any cultural tips?',
    ];
  }

  const mockChatResponse: ChatResponse = {
    messageId: `msg-${Date.now()}`,
    content: response,
    suggestions,
    timestamp: new Date(),
  };

  return {
    success: true,
    data: mockChatResponse,
    timestamp: new Date(),
  };
}

// Enhanced mock emergency responses
export function generateMockEmergencyResponse(type: EmergencyType): ApiResponse<EmergencyResponse> {
  const emergencyResponses = {
    medical: {
      confirmationMessage: "Medical emergency request received. Our team is connecting you with local medical services immediately.",
      contactInfo: {
        phone: "+1-800-MEDICAL-HELP",
        email: "medical@travelsphere.com",
      },
      estimatedResponseTime: "Within 5 minutes",
      additionalInfo: "If this is a life-threatening emergency, please call local emergency services (911, 112, etc.) immediately.",
    },
    passport: {
      confirmationMessage: "Lost passport request received. We're connecting you with the nearest embassy or consulate.",
      contactInfo: {
        phone: "+1-800-PASSPORT-HELP",
        email: "documents@travelsphere.com",
      },
      estimatedResponseTime: "Within 15 minutes",
      additionalInfo: "Please gather any identification documents you have and prepare to file a police report if required.",
    },
    hotel: {
      confirmationMessage: "Hotel issue request received. Our accommodation team is working to resolve your problem.",
      contactInfo: {
        phone: "+1-800-HOTEL-HELP",
        email: "accommodation@travelsphere.com",
      },
      estimatedResponseTime: "Within 10 minutes",
      additionalInfo: "We'll help you find alternative accommodation if needed and work with your current hotel to resolve any issues.",
    },
    'local-help': {
      confirmationMessage: "Local assistance request received. Our local support team is ready to help you.",
      contactInfo: {
        phone: "+1-800-LOCAL-HELP",
        email: "local@travelsphere.com",
      },
      estimatedResponseTime: "Within 15 minutes",
      additionalInfo: "Our local experts can help with directions, recommendations, language assistance, and general travel support.",
    },
  };

  const responseData = emergencyResponses[type];

  const mockResponse: EmergencyResponse = {
    requestId: `emergency-${Date.now()}`,
    confirmationMessage: responseData.confirmationMessage,
    contactInfo: responseData.contactInfo,
    estimatedResponseTime: responseData.estimatedResponseTime,
  };

  return {
    success: true,
    data: mockResponse,
    timestamp: new Date(),
  };
}

// Mock data health check
export function getMockDataStatus() {
  return {
    destinations: MOCK_DESTINATIONS.length,
    lastUpdated: new Date().toISOString(),
    version: '1.0.0',
    status: 'active',
  };
}