import { fireEvent, render, screen } from '@testing-library/react-native';
import EnterInvitationCode from '@/app/invite';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (p: string) => mockPush(p) } }));

it('normalises the invitation code and opens the redeem screen', async () => {
  await render(<EnterInvitationCode />);
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Invitation code'), 'grnfd-7k2qx');
  await fireEvent.press(next);
  expect(mockPush).toHaveBeenCalledWith('/invite/GRNFD7K2QX');
});
