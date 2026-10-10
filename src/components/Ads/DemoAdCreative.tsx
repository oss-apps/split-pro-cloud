import { BedDouble, CreditCard, Luggage } from 'lucide-react';
import { useEffect } from 'react';

const DEMO_ADS = [
  {
    icon: CreditCard,
    image: 'from-indigo-500 to-sky-400',
    headline: 'A travel card with no foreign transaction fees',
    description: 'Spend abroad at the real exchange rate. Free to sign up, no monthly fee.',
    url: 'northwindcard.example',
  },
  {
    icon: Luggage,
    image: 'from-amber-500 to-rose-400',
    headline: 'Carry-on bags built for long weekends',
    description: 'Fits every airline cabin limit. 100-day trial with free returns.',
    url: 'fernweh.example',
  },
  {
    icon: BedDouble,
    image: 'from-emerald-500 to-teal-400',
    headline: 'Whole homes for group trips',
    description: 'Book one place for everyone and split the stay in a few taps.',
    url: 'staytogether.example',
  },
] as const;

/**
 * Local stand-in for an AdSense In-feed ad, used when ADSENSE_DEMO is set outside production.
 * Mirrors the recommended In-feed style: 1:1 image on the left, headline, description, URL.
 */
export const DemoAdCreative: React.FC<{
  index: number;
  onStatus: (status: 'filled') => void;
}> = ({ index, onStatus }) => {
  useEffect(() => {
    const timer = setTimeout(() => onStatus('filled'), 600);
    return () => clearTimeout(timer);
  }, [onStatus]);

  const ad = DEMO_ADS[index % DEMO_ADS.length] ?? DEMO_ADS[0];
  const Icon = ad.icon;

  return (
    <a href="#" onClick={(e) => e.preventDefault()} className="flex gap-3">
      <div
        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${ad.image}`}
      >
        <Icon className="h-7 w-7 text-white/90" />
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-snug text-gray-200">{ad.headline}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-gray-400">
          {ad.description}
        </p>
        <p className="mt-1 text-xs text-gray-500">{ad.url}</p>
      </div>
    </a>
  );
};
