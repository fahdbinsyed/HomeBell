import { Redirect } from 'expo-router';
import { useSession } from '@/services/session';
import { LoadingView } from '@/ui/components';

export default function Index() {
  const { status, me, limited } = useSession();
  if (status === 'loading') return <LoadingView label="Starting HomeBell…" />;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (limited) return <Redirect href="/family/add" />;
  if (me?.termsAcceptanceRequired) return <Redirect href="/terms" />;
  return <Redirect href="/home" />;
}
