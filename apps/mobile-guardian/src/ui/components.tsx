import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toneOf, type Tone } from '@homebell/design-tokens';
import { useTheme } from './theme';

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'small' | 'label';
export function Text({ variant = 'body', style, ...rest }: TextProps & { variant?: TextVariant }) {
  const { c, font } = useTheme();
  const v: Record<TextVariant, object> = {
    title: { fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: c.text },
    heading: { fontSize: font.size.lg, fontWeight: font.weight.semibold, color: c.text },
    body: { fontSize: font.size.md, color: c.text },
    muted: { fontSize: font.size.sm, color: c.textMuted },
    small: { fontSize: font.size.xs, color: c.textMuted },
    label: { fontSize: font.size.sm, fontWeight: font.weight.medium, color: c.text },
  };
  return <RNText maxFontSizeMultiplier={1.6} style={[v[variant], style]} {...rest} />;
}

export function Screen({
  children,
  scroll = true,
  footer,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  testID?: string;
}) {
  const { c, space } = useTheme();
  const body = <View style={{ padding: space[5], gap: space[4] }}>{children}</View>;
  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={{ flex: 1, backgroundColor: c.bg }}
      testID={testID}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space[8] }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer && (
        <View
          style={{
            padding: space[5],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.surface,
          }}
        >
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  accessibilityHint,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: ViewStyle;
}) {
  const { c, radius, touchTarget, font } = useTheme();
  const bg =
    variant === 'primary'
      ? c.primary
      : variant === 'danger'
        ? c.tones.danger.fg
        : variant === 'secondary'
          ? c.surface
          : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? c.primaryText : c.text;
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: touchTarget + 4,
          borderRadius: radius.md,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: c.borderStrong,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <RNText
          style={{ color: fg, fontSize: font.size.md, fontWeight: font.weight.semibold }}
          maxFontSizeMultiplier={1.4}
        >
          {title}
        </RNText>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  onPress,
  style,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { c, radius, space } = useTheme();
  const s: ViewStyle = {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: space[4],
    gap: space[2],
  };
  if (!onPress)
    return (
      <View style={[s, style]} testID={testID}>
        {children}
      </View>
    );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [s, style, pressed && { opacity: 0.8 }]}
    >
      {children}
    </Pressable>
  );
}

export function Badge({ tone = 'neutral', label }: { tone?: Tone; label: string }) {
  const { tone: t, radius } = useTheme();
  const x = t(tone);
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: x.bg,
        borderColor: x.border,
        borderWidth: 1,
        borderRadius: radius.full,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <RNText style={{ color: x.fg, fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}
export const StateBadge = ({
  group,
  value,
  label,
}: {
  group: Parameters<typeof toneOf>[0];
  value: string;
  label: string;
}) => <Badge tone={toneOf(group, value)} label={label} />;

export function Banner({
  tone = 'info',
  title,
  message,
  action,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  const { tone: t, radius, space } = useTheme();
  const x = t(tone);
  return (
    <View
      accessible
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'}
      style={{
        backgroundColor: x.bg,
        borderColor: x.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: space[3],
        gap: space[1],
      }}
    >
      {title && <RNText style={{ color: x.fg, fontWeight: '700', fontSize: 15 }}>{title}</RNText>}
      <RNText style={{ color: x.fg, fontSize: 14 }}>{message}</RNText>
      {action}
    </View>
  );
}

export const Field = forwardRef<
  React.ComponentRef<typeof TextInput>,
  TextInputProps & { label: string; error?: string | null; hint?: string }
>(function Field({ label, error, hint, style, ...rest }, ref) {
  const { c, radius, font } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        style={[
          {
            minHeight: 52,
            borderWidth: 1,
            borderColor: error ? c.tones.danger.fg : c.borderStrong,
            borderRadius: radius.md,
            paddingHorizontal: 14,
            fontSize: font.size.lg,
            color: c.text,
            backgroundColor: c.surface,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="small" style={{ color: c.tones.danger.fg }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small">{hint}</Text>
      ) : null}
    </View>
  );
});

/** Single input with platform OTP autofill: iOS oneTimeCode, Android sms-otp (SMS Retriever). */
export function OtpField({
  value,
  onChange,
  error,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  testID?: string;
}) {
  return (
    <Field
      testID={testID}
      label="6-digit code"
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="sms-otp"
      maxLength={6}
      autoFocus
      error={error}
      style={{ letterSpacing: 12, fontSize: 28, textAlign: 'center' }}
    />
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
        backgroundColor: c.bg,
      }}
    >
      <ActivityIndicator size="large" color={c.primary} />
      <Text variant="muted">{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const { c, radius } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: 8,
        padding: 24,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.borderStrong,
      }}
    >
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message && (
        <Text variant="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      )}
      {action}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Banner tone="danger" title="Something went wrong" message={message} />
      {onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>
  );
}
