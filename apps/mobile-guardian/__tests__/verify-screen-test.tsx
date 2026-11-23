/**
 * Regression: auto-submit on the 6th digit must send all 6 digits. It previously read the code
 * from a stale render and sent 5, which the phone (slower than Jest) showed as "code isn't right".
 */
import { render, screen, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createGuardianClient, unwrap } from '@homebell/api-client';
import { createMockEnvironment, DEMO } from '@homebell/mocks/native';
import { flow } from '@/features/flow-store';
import VerifyScreen from '@/app/(auth)/verify';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (p: string) => mockReplace(p) } }));

const mockServices: { current: unknown } = { current: null };
const mockSignIn = jest.fn(async () => undefined);
jest.mock('@/services/session', () => ({
  useServices: () => mockServices.current,
  useSession: () => ({ signIn: mockSignIn }),
}));

it('auto-submits the full 6-digit code and signs in', async () => {
  const env = createMockEnvironment({ app: 'guardian', simulator: false });
  const sent: string[] = [];
  const fetchSpy: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (req.url.endsWith('/v1/auth/otp/verify')) sent.push((await req.clone().json()).code);
    return env.fetch(req);
  };
  const client = createGuardianClient({
    baseUrl: 'https://api.homebell.app',
    fetch: fetchSpy,
    getAccessToken: () => null,
    getDeviceId: () => '7b0e2f7c-1111-4222-8333-444455556666',
  });
  mockServices.current = {
    client,
    device: {
      getDeviceInfo: async () => ({
        platform: 'android',
        model: 'Pixel',
        osVersion: '16',
        appVersion: '1.0.0',
      }),
    },
  };
  flow.challenge = await unwrap(
    client.POST('/v1/auth/otp/send', { body: { phone: DEMO.phones.primary, purpose: 'login' } }),
  );

  // gcTime Infinity: no cache-cleanup timers left running after the test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={queryClient}>
      <VerifyScreen />
    </QueryClientProvider>,
  );
  // Call the handler outside act(), like a real keystroke: React has not re-rendered yet.
  const input = screen.getByLabelText('6-digit code');
  await act(async () => input.props.onChangeText('00000'));
  input.props.onChangeText(DEMO.otpCode);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'), { timeout: 5000 });
  expect(sent).toEqual([DEMO.otpCode]);
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  screen.unmount();
  queryClient.clear();
  env.stop();
});
