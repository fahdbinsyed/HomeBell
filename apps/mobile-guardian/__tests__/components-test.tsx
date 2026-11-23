import { fireEvent, render, screen } from '@testing-library/react-native';
import { Banner, Button, OtpField } from '@/ui/components';

describe('accessible components', () => {
  it('button exposes role, label and busy/disabled state', async () => {
    const onPress = jest.fn();
    await render(<Button title="Request pickup" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Request pickup' });
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);

    await render(<Button title="Sending" onPress={onPress} loading />);
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled();
  });

  it('otp field keeps digits only and caps at 6', async () => {
    const onChange = jest.fn();
    await render(<OtpField value="" onChange={onChange} />);
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '12a3-45678');
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('danger banner is announced as an alert', async () => {
    await render(<Banner tone="danger" message="Pickup requests are blocked" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Pickup requests are blocked')).toBeTruthy();
  });
});
