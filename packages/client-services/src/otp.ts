import type {
  DeviceInfo,
  InvitationPreview,
  OtpChallenge,
  OtpVerifyResult,
} from '@homebell/contracts';

/**
 * Guardian OTP flows. The real implementation is a thin wrapper over the API
 * (/v1/auth/otp/*, /v1/invitations/*); the mock drives scenario states
 * (resend limit, lockout, expired code, device conflict, no account).
 */
export interface OtpService {
  sendLoginCode(phone: string): Promise<OtpChallenge>;
  resend(challengeId: string): Promise<OtpChallenge>;
  verifyLogin(challengeId: string, code: string, device: DeviceInfo): Promise<OtpVerifyResult>;

  lookupInvitation(code: string): Promise<InvitationPreview>;
  sendInvitationCode(
    invitationId: string,
    invitationCode: string,
    phone: string,
  ): Promise<OtpChallenge>;
  redeemInvitation(args: {
    invitationId: string;
    challengeId: string;
    otpCode: string;
    device: DeviceInfo;
    fullName?: string;
    termsVersion?: string;
    idempotencyKey: string;
  }): Promise<OtpVerifyResult>;
}
