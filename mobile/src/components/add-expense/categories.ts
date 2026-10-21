/**
 * The web's expense categories (src/components/AddExpense/AddExpensePage.tsx), by section. `other`
 * in a section saves the section's own key, e.g. `food`.
 */
export const CATEGORY_SECTIONS = [
  { key: 'entertainment', items: ['games', 'movies', 'music', 'sports', 'other'] },
  { key: 'food', items: ['diningOut', 'groceries', 'liquor', 'other'] },
  {
    key: 'home',
    items: [
      'electronics',
      'furniture',
      'supplies',
      'maintenance',
      'mortgage',
      'pets',
      'rent',
      'services',
      'other',
    ],
  },
  {
    key: 'life',
    items: ['childcare', 'clothing', 'education', 'gifts', 'medical', 'taxes', 'other'],
  },
  { key: 'travel', items: ['bus', 'train', 'car', 'fuel', 'parking', 'plane', 'taxi', 'other'] },
  {
    key: 'utilities',
    items: ['cleaning', 'electricity', 'gas', 'internet', 'trash', 'phone', 'water', 'other'],
  },
] as const;

export type CategorySectionKey = (typeof CATEGORY_SECTIONS)[number]['key'];
export type CategoryKey =
  | 'general'
  | CategorySectionKey
  | Exclude<(typeof CATEGORY_SECTIONS)[number]['items'][number], 'other'>;

/** The category an item saves. */
export const toCategory = (section: CategorySectionKey, item: string) =>
  'other' === item ? section : item;
