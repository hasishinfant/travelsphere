// Single source of truth for every destination shown in TravelSphere.
//
// Every photo below was checked by eye against the place it is labelled with.
// `imageCaption` names what is actually in the frame (shown on cards) so the
// user always knows which landmark they are looking at.

export type BudgetTier = 'low' | 'medium' | 'luxury';

export interface DestinationPlace {
  name: string;
  category: string;
  description: string;
  time: string;
}

export interface DestinationFood {
  name: string;
  type: string;
  description: string;
  priceRange: string;
}

export interface DestinationRecord {
  id: string;
  name: string;            // "Paris, France"
  city: string;            // "Paris"
  country: string;         // "France"
  countryCode: string;     // "FR"
  airport: string;         // IATA code of the main airport
  region: 'europe' | 'asia' | 'americas' | 'nordics';
  description: string;
  imageUrl: string;        // base Unsplash URL, no size params
  imageCaption?: string;   // landmark in the photo
  coordinates: [number, number]; // lat, lng of the landmark in the photo
  popularityScore: number;
  category: string[];
  highlights: string[];
  bestTimeToVisit: string;
  averageCost: Record<BudgetTier, number>; // USD per day
  places: DestinationPlace[];
  food: Record<BudgetTier, DestinationFood[]>;
  tips: string[];
}

const u = (id: string) => `https://images.unsplash.com/photo-${id}`;

/** Build a sized, compressed Unsplash URL. */
export const sizedImage = (url: string, width = 800, height?: number) => {
  const base = url.split('?')[0];
  const params = new URLSearchParams({ auto: 'format', fit: 'crop', q: '72', w: String(width) });
  if (height) params.set('h', String(height));
  return `${base}?${params.toString()}`;
};

export const DESTINATIONS: DestinationRecord[] = [
  {
    id: 'paris',
    coordinates: [48.8584, 2.2945],
    name: 'Paris, France',
    city: 'Paris',
    country: 'France',
    countryCode: 'FR',
    airport: 'CDG',
    region: 'europe',
    description: 'The City of Light — iconic landmarks, world-class museums and café-lined boulevards.',
    imageUrl: u('1431274172761-fca41d930114'),
    imageCaption: 'Eiffel Tower',
    popularityScore: 95,
    category: ['culture', 'romance', 'food', 'art', 'urban'],
    highlights: ['Eiffel Tower', 'Louvre Museum', 'Montmartre', 'Seine River'],
    bestTimeToVisit: 'April–June, September–October',
    averageCost: { low: 90, medium: 180, luxury: 420 },
    places: [
      { name: 'Eiffel Tower', category: 'culture', description: 'Iron lattice icon with views across the city', time: '2–3 hours' },
      { name: 'Louvre Museum', category: 'art', description: 'Home of the Mona Lisa and 35,000 works of art', time: '3–4 hours' },
      { name: 'Montmartre & Sacré-Cœur', category: 'culture', description: 'Hilltop artists’ quarter with a white-domed basilica', time: '3 hours' },
      { name: 'Musée d’Orsay', category: 'art', description: 'Impressionist masterpieces in a former railway station', time: '2–3 hours' },
      { name: 'Seine River Cruise', category: 'relaxation', description: 'Glide past Notre-Dame and the Louvre by boat', time: '1.5 hours' },
      { name: 'Le Marais', category: 'food', description: 'Historic lanes, falafel stands and independent boutiques', time: '2 hours' },
      { name: 'Jardin du Luxembourg', category: 'nature', description: 'Formal gardens, fountains and shaded promenades', time: '1.5 hours' },
      { name: 'Champs-Élysées & Arc de Triomphe', category: 'shopping', description: 'Grand avenue ending at Napoleon’s triumphal arch', time: '2 hours' },
    ],
    food: {
      luxury: [
        { name: 'Le Jules Verne', type: 'Fine dining', description: 'Michelin-starred dining inside the Eiffel Tower', priceRange: '$$$' },
        { name: 'Septime', type: 'Modern French', description: 'Seasonal tasting menus in the 11th arrondissement', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Breizh Café', type: 'Crêperie', description: 'Buckwheat galettes and Breton cider', priceRange: '$$' },
        { name: 'Bouillon Chartier', type: 'Brasserie', description: 'Classic French dishes in an 1896 dining hall', priceRange: '$$' },
      ],
      low: [
        { name: 'L’As du Fallafel', type: 'Street food', description: 'The Marais’ famous falafel pita', priceRange: '$' },
        { name: 'Du Pain et des Idées', type: 'Bakery', description: 'Pistachio escargots and buttery viennoiserie', priceRange: '$' },
      ],
    },
    tips: [
      'Many national museums are free on the first Sunday of the month',
      'Buy a Navigo Easy card for metro and RER travel',
      'Greet shopkeepers with “Bonjour” when you walk in',
      'Book Eiffel Tower summit tickets online in advance',
    ],
  },
  {
    id: 'london',
    coordinates: [51.5055, -0.0754],
    name: 'London, UK',
    city: 'London',
    country: 'United Kingdom',
    countryCode: 'UK',
    airport: 'LHR',
    region: 'europe',
    description: 'Royal history, free world-class museums and neighbourhoods with distinct personalities.',
    imageUrl: u('1533929736458-ca588d08c8be'),
    imageCaption: 'Tower Bridge',
    popularityScore: 93,
    category: ['culture', 'urban', 'food', 'art', 'shopping'],
    highlights: ['Tower of London', 'British Museum', 'Westminster', 'Borough Market'],
    bestTimeToVisit: 'May–September',
    averageCost: { low: 100, medium: 200, luxury: 450 },
    places: [
      { name: 'Tower of London', category: 'culture', description: 'Medieval fortress guarding the Crown Jewels', time: '3 hours' },
      { name: 'British Museum', category: 'art', description: 'The Rosetta Stone and two million years of history', time: '3 hours' },
      { name: 'Westminster & Big Ben', category: 'culture', description: 'Parliament, the Abbey and the Elizabeth Tower', time: '2 hours' },
      { name: 'Borough Market', category: 'food', description: 'London’s oldest food market under Victorian ironwork', time: '1.5 hours' },
      { name: 'Hyde Park', category: 'nature', description: '350 acres of lawns, the Serpentine and Speakers’ Corner', time: '2 hours' },
      { name: 'Tate Modern', category: 'art', description: 'Modern art in a former power station on the South Bank', time: '2 hours' },
      { name: 'Covent Garden', category: 'shopping', description: 'Market halls, street performers and theatres', time: '2 hours' },
      { name: 'Camden Market', category: 'urban', description: 'Canal-side stalls, vintage fashion and street food', time: '2 hours' },
    ],
    food: {
      luxury: [
        { name: 'Core by Clare Smyth', type: 'Fine dining', description: 'Three-Michelin-star British cooking in Notting Hill', priceRange: '$$$' },
        { name: 'The Ivy', type: 'Brasserie', description: 'Theatreland institution since 1917', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Dishoom', type: 'Indian', description: 'Bombay café classics and bacon naan rolls', priceRange: '$$' },
        { name: 'Flat Iron', type: 'Steakhouse', description: 'Great-value steak in Covent Garden', priceRange: '$$' },
      ],
      low: [
        { name: 'Borough Market stalls', type: 'Street food', description: 'Toasted cheese, scotch eggs and fresh doughnuts', priceRange: '$' },
        { name: 'Beigel Bake', type: 'Bakery', description: 'Salt-beef bagels on Brick Lane, open 24 hours', priceRange: '$' },
      ],
    },
    tips: [
      'Tap a contactless card on the Tube — daily fares are capped automatically',
      'Most major museums are free to enter',
      'Stand on the right on escalators',
      'Pack a light rain layer whatever the forecast says',
    ],
  },
  {
    id: 'rome',
    coordinates: [41.8902, 12.4922],
    name: 'Rome, Italy',
    city: 'Rome',
    country: 'Italy',
    countryCode: 'IT',
    airport: 'FCO',
    region: 'europe',
    description: 'Three thousand years of history around every corner, and the best pasta of your life.',
    imageUrl: u('1552832230-c0197dd311b5'),
    imageCaption: 'Colosseum',
    popularityScore: 91,
    category: ['culture', 'food', 'art', 'romance'],
    highlights: ['Colosseum', 'Vatican Museums', 'Trevi Fountain', 'Trastevere'],
    bestTimeToVisit: 'April–June, September–October',
    averageCost: { low: 80, medium: 160, luxury: 380 },
    places: [
      { name: 'Colosseum & Roman Forum', category: 'culture', description: 'The ancient amphitheatre and the heart of Imperial Rome', time: '3 hours' },
      { name: 'Vatican Museums & Sistine Chapel', category: 'art', description: 'Michelangelo’s ceiling and the Raphael Rooms', time: '3–4 hours' },
      { name: 'Pantheon', category: 'culture', description: 'A 2,000-year-old temple with an open oculus', time: '1 hour' },
      { name: 'Trevi Fountain', category: 'culture', description: 'Baroque fountain — toss a coin to return', time: '45 min' },
      { name: 'Trastevere', category: 'food', description: 'Ivy-covered lanes and trattorias across the Tiber', time: '2–3 hours' },
      { name: 'Villa Borghese', category: 'nature', description: 'Park and gallery with Bernini sculptures', time: '2 hours' },
      { name: 'Campo de’ Fiori', category: 'shopping', description: 'Morning produce market in a lively piazza', time: '1 hour' },
    ],
    food: {
      luxury: [
        { name: 'La Pergola', type: 'Fine dining', description: 'Rome’s three-Michelin-star rooftop restaurant', priceRange: '$$$' },
        { name: 'Roscioli', type: 'Salumeria', description: 'Celebrated carbonara and an exceptional wine list', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Da Enzo al 29', type: 'Trattoria', description: 'Roman classics in Trastevere', priceRange: '$$' },
        { name: 'Armando al Pantheon', type: 'Trattoria', description: 'Family-run since 1961, steps from the Pantheon', priceRange: '$$' },
      ],
      low: [
        { name: 'Pizzarium Bonci', type: 'Pizza al taglio', description: 'Inventive pizza by the slice near the Vatican', priceRange: '$' },
        { name: 'Supplizio', type: 'Street food', description: 'Fried supplì rice balls', priceRange: '$' },
      ],
    },
    tips: [
      'Cover shoulders and knees to enter churches',
      'Book Vatican and Colosseum tickets online to skip queues',
      'Refill your bottle at the free “nasoni” drinking fountains',
      'Validate bus tickets when you board',
    ],
  },
  {
    id: 'santorini',
    coordinates: [36.4618, 25.3753],
    name: 'Santorini, Greece',
    city: 'Santorini',
    country: 'Greece',
    countryCode: 'GR',
    airport: 'JTR',
    region: 'europe',
    description: 'Whitewashed villages on caldera cliffs, blue domes and famous Aegean sunsets.',
    imageUrl: u('1570077188670-e3a8d69ac5ff'),
    imageCaption: 'Oia',
    popularityScore: 90,
    category: ['romance', 'relaxation', 'culture', 'beach'],
    highlights: ['Oia Village', 'Red Beach', 'Akrotiri', 'Fira'],
    bestTimeToVisit: 'May–October',
    averageCost: { low: 70, medium: 150, luxury: 400 },
    places: [
      { name: 'Oia Sunset Viewpoint', category: 'romance', description: 'The island’s most famous sunset over the caldera', time: '2 hours' },
      { name: 'Fira to Oia Hike', category: 'nature', description: '10 km clifftop trail between the two villages', time: '3–4 hours' },
      { name: 'Akrotiri', category: 'culture', description: 'Bronze Age town preserved under volcanic ash', time: '1.5 hours' },
      { name: 'Red Beach', category: 'beach', description: 'Dramatic red volcanic cliffs above the sea', time: '2 hours' },
      { name: 'Caldera Boat Tour', category: 'relaxation', description: 'Hot springs and the volcanic islet of Nea Kameni', time: '5 hours' },
      { name: 'Santo Wines', category: 'food', description: 'Assyrtiko tasting with caldera views', time: '1.5 hours' },
      { name: 'Perissa Black Sand Beach', category: 'beach', description: 'Long dark-sand beach with tavernas', time: '3 hours' },
    ],
    food: {
      luxury: [
        { name: 'Selene', type: 'Modern Greek', description: 'Island ingredients in an elegant Pyrgos setting', priceRange: '$$$' },
        { name: 'Lauda', type: 'Fine dining', description: 'Mediterranean tasting menu above Oia', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Metaxi Mas', type: 'Taverna', description: 'Cretan-Santorinian dishes in Exo Gonia', priceRange: '$$' },
        { name: 'Ammoudi Fish Tavern', type: 'Seafood', description: 'Grilled fish at the water’s edge below Oia', priceRange: '$$' },
      ],
      low: [
        { name: 'Lucky’s Souvlakis', type: 'Street food', description: 'Fira’s favourite pita gyros', priceRange: '$' },
        { name: 'Local bakeries', type: 'Bakery', description: 'Spanakopita and koulouri for breakfast', priceRange: '$' },
      ],
    },
    tips: [
      'Arrive at Oia an hour before sunset to find a spot',
      'Rent an ATV or use KTEL buses between villages',
      'Bring sturdy shoes — paths are steep and stepped',
      'Tap water is not drinkable; buy bottled water',
    ],
  },
  {
    id: 'tokyo',
    coordinates: [35.6595, 139.7005],
    name: 'Tokyo, Japan',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    airport: 'HND',
    region: 'asia',
    description: 'Neon-lit districts, ancient shrines and the world’s most exciting food scene.',
    imageUrl: u('1540959733332-eab4deabeeaf'),
    popularityScore: 92,
    category: ['culture', 'food', 'technology', 'urban', 'shopping'],
    highlights: ['Shibuya Crossing', 'Senso-ji', 'Tokyo Skytree', 'Tsukiji Outer Market'],
    bestTimeToVisit: 'March–May, October–November',
    averageCost: { low: 70, medium: 140, luxury: 380 },
    places: [
      { name: 'Senso-ji Temple', category: 'culture', description: 'Tokyo’s oldest temple, through the Kaminarimon gate', time: '2 hours' },
      { name: 'Shibuya Crossing', category: 'urban', description: 'The world’s busiest pedestrian scramble', time: '1 hour' },
      { name: 'Meiji Jingu', category: 'nature', description: 'Forest-wrapped shrine beside Harajuku', time: '1.5 hours' },
      { name: 'Tsukiji Outer Market', category: 'food', description: 'Tamagoyaki, fresh sushi and street snacks', time: '2 hours' },
      { name: 'teamLab Planets', category: 'technology', description: 'Immersive digital art you walk through', time: '2 hours' },
      { name: 'Tokyo Skytree', category: 'urban', description: '634 m tower with views to Mount Fuji on clear days', time: '1.5 hours' },
      { name: 'Akihabara', category: 'shopping', description: 'Electronics, anime and retro game arcades', time: '2 hours' },
      { name: 'Shinjuku Gyoen', category: 'nature', description: 'Landscaped gardens famous for cherry blossom', time: '1.5 hours' },
    ],
    food: {
      luxury: [
        { name: 'Sushi Saito', type: 'Sushi', description: 'Edomae sushi from one of Tokyo’s great masters', priceRange: '$$$' },
        { name: 'Narisawa', type: 'Innovative', description: '“Satoyama” cuisine celebrating Japan’s forests', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Ichiran Shibuya', type: 'Ramen', description: 'Tonkotsu ramen in solo flavour booths', priceRange: '$$' },
        { name: 'Torikizoku', type: 'Izakaya', description: 'Yakitori skewers at a fixed low price', priceRange: '$$' },
      ],
      low: [
        { name: 'Uobei Shibuya', type: 'Conveyor sushi', description: 'Touchscreen orders delivered by bullet lane', priceRange: '$' },
        { name: 'Konbini runs', type: 'Convenience', description: 'Onigiri and egg sandwiches from 7-Eleven or Lawson', priceRange: '$' },
      ],
    },
    tips: [
      'Get a Suica or Pasmo IC card for trains, buses and convenience stores',
      'Carry some cash — smaller restaurants may not take cards',
      'Tipping is not customary and can cause confusion',
      'Keep quiet on trains and avoid phone calls',
    ],
  },
  {
    id: 'kyoto',
    coordinates: [34.9986, 135.7850],
    name: 'Kyoto, Japan',
    city: 'Kyoto',
    country: 'Japan',
    countryCode: 'JP',
    airport: 'KIX',
    region: 'asia',
    description: 'Wooden machiya streets, 1,600 temples and Japan’s refined culinary traditions.',
    imageUrl: u('1493976040374-85c8e12f0c0e'),
    imageCaption: 'Yasaka Pagoda, Higashiyama',
    popularityScore: 89,
    category: ['culture', 'nature', 'food', 'relaxation'],
    highlights: ['Fushimi Inari', 'Kinkaku-ji', 'Arashiyama', 'Gion'],
    bestTimeToVisit: 'March–April, November',
    averageCost: { low: 65, medium: 130, luxury: 350 },
    places: [
      { name: 'Fushimi Inari Taisha', category: 'culture', description: 'Thousands of vermilion torii gates up the mountain', time: '2–3 hours' },
      { name: 'Kinkaku-ji', category: 'culture', description: 'The Golden Pavilion reflected in its pond', time: '1 hour' },
      { name: 'Arashiyama Bamboo Grove', category: 'nature', description: 'Towering bamboo paths in western Kyoto', time: '2 hours' },
      { name: 'Gion & Hanamikoji', category: 'culture', description: 'Historic geisha district at dusk', time: '1.5 hours' },
      { name: 'Nishiki Market', category: 'food', description: '“Kyoto’s kitchen” — pickles, mochi and grilled seafood', time: '1.5 hours' },
      { name: 'Kiyomizu-dera', category: 'culture', description: 'Wooden stage temple overlooking the city', time: '1.5 hours' },
      { name: 'Philosopher’s Path', category: 'nature', description: 'Canal-side walk lined with cherry trees', time: '1 hour' },
    ],
    food: {
      luxury: [
        { name: 'Kikunoi Honten', type: 'Kaiseki', description: 'Seasonal multi-course kaiseki in Higashiyama', priceRange: '$$$' },
        { name: 'Hyotei', type: 'Kaiseki', description: 'Four-century-old teahouse restaurant', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Omen', type: 'Udon', description: 'Hand-made udon near the Silver Pavilion', priceRange: '$$' },
        { name: 'Gyukatsu Kyoto Katsugyu', type: 'Katsu', description: 'Crispy beef cutlets you sear at the table', priceRange: '$$' },
      ],
      low: [
        { name: 'Nishiki Market stalls', type: 'Street food', description: 'Tako tamago, soy-milk doughnuts and yuba', priceRange: '$' },
        { name: 'Inari sushi stands', type: 'Snacks', description: 'Sweet tofu-pouch sushi near Fushimi Inari', priceRange: '$' },
      ],
    },
    tips: [
      'Visit Fushimi Inari before 8 am to beat the crowds',
      'Buses are the main transit — get a one-day pass',
      'Photography is restricted on Gion’s private lanes',
      'Many temples close by 5 pm',
    ],
  },
  {
    id: 'bali',
    coordinates: [-8.2752, 115.1668],
    name: 'Bali, Indonesia',
    city: 'Bali',
    country: 'Indonesia',
    countryCode: 'ID',
    airport: 'DPS',
    region: 'asia',
    description: 'Lakeside water temples, emerald rice terraces and surf beaches on the Island of the Gods.',
    imageUrl: u('1604999333679-b86d54738315'),
    imageCaption: 'Pura Ulun Danu Beratan',
    popularityScore: 88,
    category: ['nature', 'relaxation', 'culture', 'beach'],
    highlights: ['Ubud', 'Tanah Lot', 'Tegallalang', 'Uluwatu'],
    bestTimeToVisit: 'April–October',
    averageCost: { low: 40, medium: 90, luxury: 260 },
    places: [
      { name: 'Tegallalang Rice Terraces', category: 'nature', description: 'Terraced paddies carved into the Ubud hillsides', time: '2 hours' },
      { name: 'Pura Ulun Danu Beratan', category: 'culture', description: 'Water temple floating on Lake Beratan', time: '1.5 hours' },
      { name: 'Tanah Lot', category: 'culture', description: 'Sea temple on a rock, best at sunset', time: '2 hours' },
      { name: 'Sacred Monkey Forest', category: 'nature', description: 'Ancient temples among long-tailed macaques', time: '1.5 hours' },
      { name: 'Uluwatu Temple & Kecak Dance', category: 'culture', description: 'Clifftop temple and fire dance at dusk', time: '3 hours' },
      { name: 'Seminyak Beach', category: 'beach', description: 'Sunset beach clubs and surf', time: '3 hours' },
      { name: 'Ubud Art Market', category: 'shopping', description: 'Woven baskets, sarongs and wood carvings', time: '1.5 hours' },
    ],
    food: {
      luxury: [
        { name: 'Locavore NXT', type: 'Fine dining', description: 'Indonesian ingredients reimagined in Ubud', priceRange: '$$$' },
        { name: 'Mozaic', type: 'French-Balinese', description: 'Tasting menus in a tropical garden', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Bebek Bengil', type: 'Balinese', description: 'Crispy duck overlooking rice fields', priceRange: '$$' },
        { name: 'Warung Babi Guling Ibu Oka', type: 'Balinese', description: 'Ubud’s famous spit-roast pork', priceRange: '$$' },
      ],
      low: [
        { name: 'Local warungs', type: 'Indonesian', description: 'Nasi campur plates for a few dollars', priceRange: '$' },
        { name: 'Gianyar Night Market', type: 'Street food', description: 'Satay, martabak and sweet treats', priceRange: '$' },
      ],
    },
    tips: [
      'Wear a sarong and sash at temples — many lend them at the entrance',
      'Agree on taxi fares first or use Grab or Gojek',
      'Drink bottled or filtered water only',
      'Expect road closures during ceremonies',
    ],
  },
  {
    id: 'new-york',
    coordinates: [40.7580, -73.9855],
    name: 'New York City, USA',
    city: 'New York',
    country: 'United States',
    countryCode: 'US',
    airport: 'JFK',
    region: 'americas',
    description: 'Skyline views, Broadway nights and neighbourhoods that each feel like their own city.',
    imageUrl: u('1496442226666-8d4d0e62e6e9'),
    imageCaption: 'Times Square',
    popularityScore: 94,
    category: ['urban', 'culture', 'entertainment', 'food', 'shopping', 'art'],
    highlights: ['Central Park', 'Statue of Liberty', 'Brooklyn Bridge', 'The Met'],
    bestTimeToVisit: 'April–June, September–November',
    averageCost: { low: 120, medium: 240, luxury: 550 },
    places: [
      { name: 'Central Park', category: 'nature', description: '843 acres of lawns, lakes and Bethesda Terrace', time: '2–3 hours' },
      { name: 'Statue of Liberty & Ellis Island', category: 'culture', description: 'Ferry to Lady Liberty and the immigration museum', time: '4 hours' },
      { name: 'The Metropolitan Museum of Art', category: 'art', description: '5,000 years of art on Fifth Avenue', time: '3 hours' },
      { name: 'Brooklyn Bridge & DUMBO', category: 'urban', description: 'Walk the bridge to cobbled DUMBO', time: '2 hours' },
      { name: 'Top of the Rock', category: 'urban', description: 'Observation deck framing the Empire State Building', time: '1 hour' },
      { name: 'Chelsea Market & High Line', category: 'food', description: 'Food hall and elevated park on old rail tracks', time: '2.5 hours' },
      { name: 'Broadway Show', category: 'entertainment', description: 'An evening in the Theater District', time: '3 hours' },
      { name: 'SoHo', category: 'shopping', description: 'Cast-iron buildings and flagship boutiques', time: '2 hours' },
    ],
    food: {
      luxury: [
        { name: 'Le Bernardin', type: 'Seafood', description: 'Three-Michelin-star seafood in Midtown', priceRange: '$$$' },
        { name: 'Carbone', type: 'Italian-American', description: 'Theatrical red-sauce classics in Greenwich Village', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Katz’s Delicatessen', type: 'Deli', description: 'Hand-cut pastrami on rye since 1888', priceRange: '$$' },
        { name: 'Joe’s Shanghai', type: 'Chinese', description: 'Soup dumplings in Chinatown', priceRange: '$$' },
      ],
      low: [
        { name: 'Joe’s Pizza', type: 'Pizza', description: 'Classic New York slice in the Village', priceRange: '$' },
        { name: 'The Halal Guys', type: 'Street food', description: 'Chicken over rice from the original cart', priceRange: '$' },
      ],
    },
    tips: [
      'Tap a contactless card with OMNY on subways and buses',
      'Walk on the right and keep moving on busy sidewalks',
      'Tip 18–20% at sit-down restaurants',
      'Broadway TKTS booths sell same-day discounted seats',
    ],
  },
  {
    id: 'iceland',
    coordinates: [63.6156, -19.9886],
    name: 'Reykjavík, Iceland',
    city: 'Reykjavík',
    country: 'Iceland',
    countryCode: 'IS',
    airport: 'KEF',
    region: 'nordics',
    description: 'Gateway to waterfalls, glaciers, geothermal lagoons and the Northern Lights.',
    imageUrl: u('1476610182048-b716b8518aae'),
    imageCaption: 'Seljalandsfoss, South Coast',
    popularityScore: 85,
    category: ['nature', 'adventure', 'unique', 'relaxation'],
    highlights: ['Golden Circle', 'Blue Lagoon', 'South Coast', 'Northern Lights'],
    bestTimeToVisit: 'June–August; September–March for auroras',
    averageCost: { low: 120, medium: 230, luxury: 500 },
    places: [
      { name: 'Hallgrímskirkja', category: 'culture', description: 'Basalt-inspired church with a city-view tower', time: '1 hour' },
      { name: 'Golden Circle', category: 'nature', description: 'Þingvellir, Geysir and Gullfoss in one loop', time: 'Full day' },
      { name: 'Seljalandsfoss & Skógafoss', category: 'nature', description: 'Walk behind one waterfall, climb beside the other', time: '4 hours' },
      { name: 'Blue Lagoon', category: 'relaxation', description: 'Milky-blue geothermal spa in a lava field', time: '3 hours' },
      { name: 'Reynisfjara Black Sand Beach', category: 'nature', description: 'Basalt columns and sea stacks near Vík', time: '1.5 hours' },
      { name: 'Northern Lights Tour', category: 'adventure', description: 'Chase the aurora away from city lights (Sep–Mar)', time: '4 hours' },
      { name: 'Harpa Concert Hall', category: 'culture', description: 'Glass-façade concert hall on the harbour', time: '1 hour' },
    ],
    food: {
      luxury: [
        { name: 'Dill', type: 'New Nordic', description: 'Iceland’s first Michelin-starred restaurant', priceRange: '$$$' },
        { name: 'Grillmarkaðurinn', type: 'Grill', description: 'Local lamb and fish in a stone-walled dining room', priceRange: '$$$' },
      ],
      medium: [
        { name: 'Messinn', type: 'Seafood', description: 'Fish pans served sizzling in cast iron', priceRange: '$$' },
        { name: 'Sægreifinn (Sea Baron)', type: 'Seafood', description: 'Harbour shack famous for lobster soup', priceRange: '$$' },
      ],
      low: [
        { name: 'Bæjarins Beztu Pylsur', type: 'Hot dogs', description: 'Lamb hot dog “with everything”', priceRange: '$' },
        { name: 'Brauð & Co', type: 'Bakery', description: 'Cinnamon snails fresh from the oven', priceRange: '$' },
      ],
    },
    tips: [
      'Check road.is and vedur.is before every drive',
      'Tap water is excellent — skip bottled water',
      'Layer up: weather changes fast, even in summer',
      'Book Blue Lagoon time slots in advance',
    ],
  },
  {
    id: 'bengaluru',
    coordinates: [12.9791, 77.5913],
    name: 'Bengaluru, India',
    city: 'Bengaluru',
    country: 'India',
    countryCode: 'IN',
    airport: 'BLR',
    region: 'asia',
    description: 'India’s Garden City — leafy parks, palace architecture and a legendary dosa scene.',
    imageUrl: u('1697130383976-38f28c444292'),
    imageCaption: 'Vidhana Soudha',
    popularityScore: 84,
    category: ['culture', 'technology', 'food', 'nature'],
    highlights: ['Lalbagh', 'Bangalore Palace', 'Cubbon Park', 'Vidhana Soudha'],
    bestTimeToVisit: 'October–February',
    averageCost: { low: 30, medium: 70, luxury: 180 },
    places: [
      { name: 'Lalbagh Botanical Garden', category: 'nature', description: '240-acre garden with a Victorian glasshouse', time: '2 hours' },
      { name: 'Bangalore Palace', category: 'culture', description: 'Tudor-style palace of the Wodeyar dynasty', time: '1.5 hours' },
      { name: 'Cubbon Park', category: 'nature', description: 'Shaded green lung beside the state legislature', time: '1.5 hours' },
      { name: 'Vidhana Soudha', category: 'culture', description: 'Neo-Dravidian seat of the Karnataka legislature', time: '45 min' },
      { name: 'Tipu Sultan’s Summer Palace', category: 'culture', description: 'Teak-pillared 18th-century palace', time: '1 hour' },
      { name: 'VV Puram Food Street', category: 'food', description: 'Evening street of dosas, chaats and sweets', time: '1.5 hours' },
      { name: 'Commercial Street', category: 'shopping', description: 'Busy bazaar for textiles and jewellery', time: '2 hours' },
    ],
    food: {
      luxury: [
        { name: 'Karavalli', type: 'Coastal Indian', description: 'Award-winning coastal cuisine at the Gateway Hotel', priceRange: '$$$' },
        { name: 'Farmlore', type: 'Fine dining', description: 'Farm-to-table tasting menus outside the city', priceRange: '$$$' },
      ],
      medium: [
        { name: 'MTR (Mavalli Tiffin Rooms)', type: 'South Indian', description: 'Rava idli and filter coffee since 1924', priceRange: '$$' },
        { name: 'Vidyarthi Bhavan', type: 'South Indian', description: 'Crisp masala dosas served since 1943', priceRange: '$$' },
      ],
      low: [
        { name: 'CTR (Central Tiffin Room)', type: 'South Indian', description: 'Butter-laden benne dosa in Malleshwaram', priceRange: '$' },
        { name: 'Veena Stores', type: 'Breakfast', description: 'Idli, vada and khara bath', priceRange: '$' },
      ],
    },
    tips: [
      'Use Namma Metro to skip traffic on major routes',
      'Book cabs with Uber, Ola or Namma Yatri for fixed fares',
      'Remove shoes before entering temples',
      'Evenings can be cool — carry a light layer',
    ],
  },
];

/** Key-less Google Maps embed centred on the destination's landmark. */
export const mapEmbedUrl = (d: Pick<DestinationRecord, 'coordinates'>, zoom = 15) =>
  `https://maps.google.com/maps?q=${d.coordinates[0]},${d.coordinates[1]}&z=${zoom}&t=k&output=embed`;

export const getDestination = (idOrName: string | undefined | null): DestinationRecord | undefined => {
  if (!idOrName) return undefined;
  const q = idOrName.trim().toLowerCase();
  return (
    DESTINATIONS.find(d => d.id === q) ||
    DESTINATIONS.find(d => d.city.toLowerCase() === q || d.name.toLowerCase() === q) ||
    DESTINATIONS.find(d => d.name.toLowerCase().includes(q) || q.includes(d.city.toLowerCase()))
  );
};

/** Category groups shown in the sidebar "Explore" list. */
export const DESTINATION_GROUPS = [
  { id: 'europe', label: 'Europe', swatch: 'var(--swatch-orange)' },
  { id: 'asia', label: 'Asia', swatch: 'var(--swatch-violet)' },
  { id: 'americas', label: 'Americas', swatch: 'var(--swatch-teal)' },
  { id: 'nordics', label: 'Nordics', swatch: 'var(--swatch-blue)' },
] as const;

/** Curated experiences — each tied to a plannable destination. */
export const EXPERIENCES = [
  {
    id: 'oia-sunset',
    title: 'Caldera sunset walk',
    location: 'Oia, Santorini',
    destinationId: 'santorini',
    image: u('1580502304784-8985b7eb7260'),
    duration: '3 hours',
    rating: 4.9,
    price: 65,
    tag: 'Romance',
  },
  {
    id: 'ubud-terraces',
    title: 'Rice terraces & water temples',
    location: 'Tegallalang, Bali',
    destinationId: 'bali',
    image: u('1555400038-63f5ba517a47'),
    duration: 'Full day',
    rating: 4.8,
    price: 55,
    tag: 'Nature',
  },
  {
    id: 'higashiyama',
    title: 'Higashiyama lanes at dusk',
    location: 'Kyoto, Japan',
    destinationId: 'kyoto',
    image: u('1493976040374-85c8e12f0c0e'),
    duration: '2.5 hours',
    rating: 4.9,
    price: 48,
    tag: 'Culture',
  },
  {
    id: 'seine-evening',
    title: 'Seine bridges by night',
    location: 'Pont Alexandre III, Paris',
    destinationId: 'paris',
    image: u('1499856871958-5b9627545d1a'),
    duration: '2 hours',
    rating: 4.7,
    price: 39,
    tag: 'City',
  },
  {
    id: 'tanah-lot',
    title: 'Tanah Lot at golden hour',
    location: 'Tabanan, Bali',
    destinationId: 'bali',
    image: u('1518548419970-58e3b4079ab2'),
    duration: '3 hours',
    rating: 4.8,
    price: 42,
    tag: 'Culture',
  },
  {
    id: 'vestrahorn',
    title: 'Vestrahorn black-sand shores',
    location: 'Stokksnes, Iceland',
    destinationId: 'iceland',
    image: u('1504829857797-ddff29c27927'),
    duration: 'Full day',
    rating: 4.9,
    price: 120,
    tag: 'Adventure',
  },
];

/** Hotel photography (generic properties, not tied to a city). */
export const HOTEL_IMAGES = [
  u('1566073771259-6a8506099945'),
  u('1542314831-068cd1dbfeeb'),
  u('1571896349842-33c89424de2d'),
  u('1520250497591-112f2f40a3f4'),
];

/** Hotel photos matched to the mock hotel names (each checked by eye). */
const HOTEL_PHOTOS: Record<string, string> = {
  'Grand Plaza Hotel': u('1564501049412-61c2a3083791'),
  'Sunset Beach Resort': u('1551918120-9739cb430c6d'),
  'City Center Inn': u('1631049307264-da0ec9d70304'),
  'Royal Palace Hotel': u('1590490360182-c33d57733427'),
  'Ocean View Resort': u('1584132967334-10e028bd69f7'),
  'Mountain Lodge': u('1445019980597-93fa8acb246c'),
  'Downtown Suites': u('1618773928121-c32242e63f39'),
  'Riverside Hotel': u('1611892440504-42a792e24d32'),
  'Garden Paradise Resort': u('1551882547-ff40c63fe5fa'),
  'Metropolitan Hotel': u('1542314831-068cd1dbfeeb'),
  'Lakeside Inn': u('1596394516093-501ba68a0ba6'),
  'Heritage Hotel': u('1578683010236-d716f9a3f461'),
};
const HOTEL_POOL = Object.values(HOTEL_PHOTOS);

export const hotelPhotoFor = (name: string, index = 0) =>
  sizedImage(HOTEL_PHOTOS[name] || HOTEL_POOL[index % HOTEL_POOL.length], 640, 440);

/** Gallery for hotel details: exterior/pool + rooms. */
export const hotelGallery = (seed = 0) =>
  [0, 1, 2, 3].map(i => sizedImage(HOTEL_POOL[(seed + i * 3) % HOTEL_POOL.length], 1000, 700));
