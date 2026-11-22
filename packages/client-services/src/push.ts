import type { NotificationType, PushProvider } from '@homebell/contracts';
import type { Subscription } from './realtime';

export interface PushToken {
  provider: PushProvider;
  token: string;
}

export interface IncomingPush {
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  /** true when the user tapped the notification (app opened from it). */
  opened: boolean;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** Mock (Phase 1) → FCM via provider abstraction (Phase 7). */
export interface PushService {
  getPermission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  getToken(): Promise<PushToken | null>;
  onTokenRefresh(listener: (token: PushToken) => void): Subscription;
  onPush(listener: (push: IncomingPush) => void): Subscription;
}
