/** iOS uses the platform-specific SwiftUI implementation; other platforms keep FlatList. */
export const NativeBalances = (_props: {
  data?: import('@/lib/api').RouterOutputs['user']['getBalances'];
  search: string;
  loading: boolean;
  error?: string;
  onRefresh: () => Promise<void>;
}) => null;
