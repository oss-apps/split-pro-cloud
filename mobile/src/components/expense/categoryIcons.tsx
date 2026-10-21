import React from 'react';
import { type ColorValue } from 'react-native';

import { Icon, type IconName } from '@/components/ui';

/** System symbols for the web's categories (src/components/ui/categoryIcons.tsx). */
export const CATEGORY_ICONS: Record<string, IconName> = {
  games: { ios: 'gamecontroller', android: 'sports_esports' },
  movies: { ios: 'popcorn', android: 'movie' },
  music: { ios: 'music.note', android: 'music_note' },
  sports: { ios: 'trophy', android: 'emoji_events' },
  entertainment: { ios: 'ticket', android: 'local_activity' },
  food: { ios: 'takeoutbag.and.cup.and.straw', android: 'fastfood' },
  diningOut: { ios: 'fork.knife', android: 'restaurant' },
  groceries: { ios: 'cart', android: 'shopping_cart' },
  liquor: { ios: 'wineglass', android: 'wine_bar' },
  home: { ios: 'house', android: 'home' },
  electronics: { ios: 'powerplug', android: 'power' },
  furniture: { ios: 'sofa', android: 'chair' },
  supplies: { ios: 'shippingbox', android: 'inventory_2' },
  maintenance: { ios: 'wrench.and.screwdriver', android: 'construction' },
  mortgage: { ios: 'building.columns', android: 'account_balance' },
  pets: { ios: 'pawprint', android: 'pets' },
  rent: { ios: 'key', android: 'key' },
  services: { ios: 'hammer', android: 'build' },
  life: { ios: 'leaf', android: 'eco' },
  childcare: { ios: 'figure.and.child.holdinghands', android: 'child_care' },
  clothing: { ios: 'tshirt', android: 'checkroom' },
  education: { ios: 'graduationcap', android: 'school' },
  gifts: { ios: 'gift', android: 'redeem' },
  medical: { ios: 'stethoscope', android: 'medical_services' },
  taxes: { ios: 'doc.text', android: 'request_quote' },
  travel: { ios: 'suitcase', android: 'luggage' },
  bus: { ios: 'bus', android: 'directions_bus' },
  train: { ios: 'tram', android: 'train' },
  car: { ios: 'car', android: 'directions_car' },
  fuel: { ios: 'fuelpump', android: 'local_gas_station' },
  parking: { ios: 'parkingsign', android: 'local_parking' },
  plane: { ios: 'airplane', android: 'flight' },
  taxi: { ios: 'car.rear', android: 'local_taxi' },
  utilities: { ios: 'wrench.adjustable', android: 'plumbing' },
  electricity: { ios: 'bolt', android: 'bolt' },
  gas: { ios: 'flame', android: 'local_fire_department' },
  internet: { ios: 'wifi', android: 'wifi' },
  phone: { ios: 'phone', android: 'call' },
  water: { ios: 'drop', android: 'water_drop' },
  general: { ios: 'banknote', android: 'payments' },
  cleaning: { ios: 'bubbles.and.sparkles', android: 'cleaning_services' },
  trash: { ios: 'trash', android: 'delete' },
};

const FALLBACK: IconName = { ios: 'banknote', android: 'payments' };

export const getCategoryIcon = (category: string): IconName => CATEGORY_ICONS[category] ?? FALLBACK;

/** The symbol for an expense category, like the web's `CategoryIcon`. */
export const CategoryIcon: React.FC<{ category: string; color?: ColorValue; size?: number }> = ({
  category,
  color,
  size,
}) => <Icon name={getCategoryIcon(category)} color={color} size={size} />;
