import type { ErrorCode } from '@homebell/contracts';

/**
 * User-facing message per contract error code. Typed as Record<ErrorCode, …> so adding a code to the
 * contract fails the build until it has copy here. UIs branch on `code`, never on server `detail`.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some details need fixing.',
  BAD_REQUEST: 'Something about that request was not right. Please try again.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  SESSION_REVOKED: 'You were signed out. Please sign in again.',
  FORBIDDEN: "You don't have permission to do that.",
  SCOPE_INSUFFICIENT: "This session can't do that.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  CONFLICT: 'That change conflicts with the current state. Refresh and try again.',
  PRECONDITION_FAILED: 'Someone else changed this. Reload to see the latest version.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong sending that. Please try again.',
  IDEMPOTENCY_KEY_REUSED: 'That request was already sent with different details.',
  IDEMPOTENCY_IN_PROGRESS: 'Still working on your last request…',
  PAYLOAD_TOO_LARGE: 'That file is too large.',
  UNSUPPORTED_MEDIA_TYPE: "That file type isn't supported.",
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  SERVICE_UNAVAILABLE: 'HomeBell is temporarily unavailable. Please try again shortly.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  MFA_REQUIRED: 'Enter the code from your authenticator app.',
  MFA_INVALID: "That code didn't work. Check your authenticator app and try again.",
  MFA_ENROLLMENT_REQUIRED: 'Set up two-step verification to continue.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Your account is locked for a few minutes.',
  ACCOUNT_DEACTIVATED: 'This account has been deactivated.',
  REFRESH_TOKEN_INVALID: 'Your session ended. Please sign in again.',
  REFRESH_TOKEN_REUSED: 'For your security you were signed out. Please sign in again.',
  PASSWORD_POLICY_VIOLATION: 'Choose a password of at least 12 characters.',
  STAFF_INVITATION_INVALID: 'This link is invalid or has expired. Ask for a new one.',
  SUPPORT_SESSION_EXPIRED: 'The support session has ended.',
  OTP_RESEND_TOO_SOON: 'Please wait before requesting another code.',
  OTP_SEND_LIMIT_REACHED: "You've requested too many codes. Try again in 15 minutes.",
  OTP_INVALID: "That code isn't right.",
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  OTP_ATTEMPTS_EXCEEDED: 'Too many wrong codes. Request a new one.',
  OTP_LOCKED: 'Too many attempts. Verification is paused for this number for a while.',
  OTP_CHALLENGE_NOT_FOUND: 'That code request has ended. Request a new code.',
  OTP_TEMPORARILY_UNAVAILABLE: "We can't send codes right now. Please try again shortly.",
  PHONE_NOT_SUPPORTED: "This phone number's country isn't supported yet.",
  DEVICE_ID_REQUIRED: 'Something is wrong with this app install. Please reinstall the app.',
  DEVICE_REVOKED: 'Your account was moved to another phone. Sign in again to use it here.',
  DEVICE_MISMATCH: 'Please sign in again on this device.',
  DEVICE_TRANSFER_COOLDOWN:
    'This account was moved to a new phone recently. Another move is possible later.',
  DEVICE_CONFLICT_TOKEN_INVALID: 'That step timed out. Please verify your phone again.',
  COOLDOWN_OVERRIDE_LIMIT_REACHED:
    'The school override limit for this term is reached. Contact HomeBell support.',
  TENANT_NOT_OPERATIONAL: "This school's HomeBell service isn't active right now.",
  TENANT_READ_ONLY: 'This school is in read-only mode. Changes are paused.',
  FEATURE_NOT_ENTITLED: "This feature isn't included in the school's plan.",
  LIMIT_EXCEEDED: 'The plan limit has been reached.',
  INVALID_LIFECYCLE_TRANSITION: "That action isn't available in the school's current state.",
  LIFECYCLE_STATE_CHANGED:
    "The school's state changed since you opened this page. Reload and try again.",
  TENANT_SLUG_TAKEN: 'That address is already taken.',
  PLAN_VERSION_NOT_PUBLISHED: 'Assign a published plan version first.',
  GUARDIAN_BLOCKED:
    'Pickup requests are blocked for your account at this school. Please contact the school.',
  GUARDIAN_DEACTIVATED:
    'Your access at this school has been deactivated. Please contact the school.',
  GUARDIAN_ACCESS_EXPIRED: 'Your access has expired. Ask the primary guardian to extend it.',
  GUARDIAN_REVOKED: 'Your access was removed by the primary guardian.',
  GUARDIAN_NOT_LINKED: "You're not linked to that child.",
  GUARDIAN_PHONE_IN_USE: 'That phone number is already used by another guardian.',
  PRIMARY_GUARDIAN_EXISTS: 'This child already has a primary guardian.',
  PRIMARY_GUARDIAN_REQUIRED: 'Every child needs one primary guardian.',
  ADDITIONAL_GUARDIAN_LIMIT_REACHED:
    'The maximum number of additional guardians for this child is reached.',
  STUDENT_INACTIVE: 'This student is inactive.',
  STUDENT_NOT_ELIGIBLE:
    'This child is not available for parent pickup today. Please contact the school.',
  CLASS_NOT_EMPTY: 'Move or remove the students first.',
  OUTSIDE_DISMISSAL_WINDOW: 'Pickup requests are not open right now.',
  LOCATION_REQUIRED: 'This school needs your location to request pickup.',
  OUTSIDE_PICKUP_ZONE: "You're not close enough to the school yet.",
  DUPLICATE_ACTIVE_REQUEST: 'A pickup request is already open for this child today.',
  INVALID_PICKUP_TRANSITION: "That isn't possible for this request anymore.",
  PICKUP_REQUEST_CLOSED: 'This request is already closed.',
  SENT_OUT_STEP_DISABLED: 'This school does not use the "sent out" step.',
  INVITATION_NOT_FOUND: "We couldn't find that invitation code. Check it and try again.",
  INVITATION_EXPIRED: 'This invitation has expired. Ask for a new one.',
  INVITATION_ALREADY_USED: 'This invitation has already been used.',
  INVITATION_REVOKED: 'This invitation was cancelled.',
  INVITATION_PHONE_MISMATCH: "That number doesn't match the invitation.",
  NO_AVAILABLE_SEAT: 'Buy an additional guardian license first.',
  SEAT_REASSIGNMENT_LIMIT: 'This license has been reassigned too many times this term.',
  INVALID_VALIDITY_WINDOW: 'Choose a valid access period within the school term.',
  PURCHASE_VERIFICATION_FAILED:
    "We couldn't verify that purchase with the store. You have not been granted access.",
  PURCHASE_ALREADY_PROCESSED: 'That purchase was already applied.',
  PURCHASE_PENDING: 'Your purchase is pending at the store. We will update you once it completes.',
  PURCHASE_INTENT_EXPIRED: 'That purchase took too long. Please start again.',
  PAIRING_CODE_INVALID: "That code doesn't match a screen waiting to pair.",
  PAIRING_CODE_EXPIRED: 'That code has expired. Refresh the screen for a new one.',
  DISPLAY_REVOKED: 'This screen was unpaired.',
  DISPLAY_LIMIT_REACHED: "The plan's display screen limit is reached.",
  QUEUE_CATCHUP_GAP_TOO_LARGE: 'Refreshing the queue…',
  IMPORT_INVALID_FILE: "That file isn't a valid HomeBell CSV. Download the template and try again.",
  IMPORT_NOT_VALIDATED: 'The import is still being checked.',
  IMPORT_HAS_ERRORS: 'Some rows have errors. Fix them or import only the valid rows.',
  IMPORT_ALREADY_COMMITTED: 'This import was already completed.',
};

export const NETWORK_ERROR_MESSAGE = "Can't reach HomeBell. Check your connection and try again.";

export function errorMessage(code: string | null | undefined): string {
  if (!code || code === 'NETWORK_OR_UNKNOWN') return NETWORK_ERROR_MESSAGE;
  return (
    (ERROR_MESSAGES as Record<string, string>)[code] ?? 'Something went wrong. Please try again.'
  );
}
