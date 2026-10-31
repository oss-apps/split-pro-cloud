import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

/** The signed-in user: fresh from `user.me`, or the one saved at sign-in until that loads. */
export const useCurrentUser = () => {
  const sessionUser = useAuthStore((state) => state.user);
  const meQuery = api.user.me.useQuery();

  return meQuery.data ?? sessionUser;
};
