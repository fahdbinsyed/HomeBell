import type { DeviceConflict, InvitationPreview, OtpChallenge } from '@homebell/contracts';

/**
 * Short-lived, in-memory hand-off between sign-in screens (never persisted; no secrets beyond the
 * 5-minute conflict token, which is single use).
 */
export const flow: {
  phone: string;
  challenge: OtpChallenge | null;
  conflict: DeviceConflict | null;
  invitation: (InvitationPreview & { code: string }) | null;
} = { phone: '', challenge: null, conflict: null, invitation: null };

export const resetFlow = () => {
  flow.phone = '';
  flow.challenge = null;
  flow.conflict = null;
  flow.invitation = null;
};

/** Normalise user input to E.164 (+1 default for 10-digit numbers in the mock market). */
export function toE164(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
