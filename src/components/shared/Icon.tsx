// Icon — one consistent line-icon family (Lucide, 1.75 stroke) for the whole app.
import React from 'react';
import {
  Palmtree, Mountain, Waves, Building2, Trees, Sun,
  UtensilsCrossed, Utensils, Coffee, Wine, Soup,
  Siren, Stethoscope, BookUser, Hotel, LifeBuoy, Phone,
  MessageCircle, MessageSquare, Send, Sparkles, HelpCircle,
  Plane, Car, TrainFront, Bus, Footprints, Map,
  Backpack, Landmark, Leaf, ShoppingBag, Camera, Star,
  X, Menu, Search, Calendar, MapPin, Heart,
  Check, AlertTriangle, XCircle, Info, Loader2, ArrowRight,
  ArrowLeft, ArrowUp, ArrowDown, Plus, Minus,
  Glasses, Eye, Maximize2, Play,
  Download, Mail, RefreshCw, User, Baby, Paperclip, Wallet, Clock, ClipboardList, Globe2, Luggage,
  WifiOff, Wrench, Languages, CloudSun, ShieldCheck, Bot, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  // Destinations
  | 'destination' | 'mountain' | 'beach' | 'city' | 'forest' | 'desert'
  // Food & Dining
  | 'food' | 'restaurant' | 'coffee' | 'wine' | 'local-food'
  // Safety & Emergency
  | 'emergency' | 'medical' | 'passport' | 'hotel' | 'help' | 'phone'
  // Chat & Communication
  | 'chat' | 'message' | 'send' | 'assistant' | 'question'
  // Travel & Transportation
  | 'plane' | 'car' | 'train' | 'bus' | 'walk' | 'map'
  // Activities & Interests
  | 'adventure' | 'culture' | 'nature' | 'shopping' | 'camera' | 'star'
  // UI Elements
  | 'close' | 'menu' | 'search' | 'calendar' | 'location' | 'heart'
  | 'check' | 'warning' | 'error' | 'info' | 'loading' | 'arrow-right'
  | 'arrow-left' | 'arrow-up' | 'arrow-down' | 'plus' | 'minus'
  // VR & Technology
  | 'vr' | 'preview' | 'fullscreen' | 'play'
  // Extras
  | 'download' | 'mail' | 'refresh' | 'user' | 'child' | 'attach' | 'wallet' | 'clock' | 'clipboard'
  | 'globe' | 'luggage' | 'offline' | 'maintenance' | 'translate' | 'weather' | 'shield' | 'bot' | 'success';

interface IconProps {
  name: IconName;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  color?: string;
  'aria-label'?: string;
}

const iconMap: Record<IconName, LucideIcon> = {
  destination: Palmtree, mountain: Mountain, beach: Waves, city: Building2, forest: Trees, desert: Sun,
  food: UtensilsCrossed, restaurant: Utensils, coffee: Coffee, wine: Wine, 'local-food': Soup,
  emergency: Siren, medical: Stethoscope, passport: BookUser, hotel: Hotel, help: LifeBuoy, phone: Phone,
  chat: MessageCircle, message: MessageSquare, send: Send, assistant: Sparkles, question: HelpCircle,
  plane: Plane, car: Car, train: TrainFront, bus: Bus, walk: Footprints, map: Map,
  adventure: Backpack, culture: Landmark, nature: Leaf, shopping: ShoppingBag, camera: Camera, star: Star,
  close: X, menu: Menu, search: Search, calendar: Calendar, location: MapPin, heart: Heart,
  check: Check, warning: AlertTriangle, error: XCircle, info: Info, loading: Loader2,
  'arrow-right': ArrowRight, 'arrow-left': ArrowLeft, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown,
  plus: Plus, minus: Minus,
  vr: Glasses, preview: Eye, fullscreen: Maximize2, play: Play,
  download: Download, mail: Mail, refresh: RefreshCw, user: User, child: Baby, attach: Paperclip,
  wallet: Wallet, clock: Clock, clipboard: ClipboardList, globe: Globe2, luggage: Luggage,
  offline: WifiOff, maintenance: Wrench, translate: Languages, weather: CloudSun, shield: ShieldCheck,
  bot: Bot, success: CheckCircle2,
};

const sizeMap = { xs: 12, sm: 16, md: 18, lg: 22, xl: 28, '2xl': 36 } as const;

const Icon: React.FC<IconProps> = ({ name, size = 'md', className = '', color, 'aria-label': ariaLabel }) => {
  const Glyph = iconMap[name] || HelpCircle;
  return (
    <Glyph
      className={`icon icon-${name} icon-${size} ${name === 'loading' ? 'icon-spin' : ''} ${className}`.trim()}
      size={sizeMap[size]}
      strokeWidth={1.75}
      color={color || 'currentColor'}
      role="img"
      aria-label={ariaLabel || name}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
};

export default Icon;

