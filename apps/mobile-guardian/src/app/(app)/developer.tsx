import { useState } from 'react';
import { DEMO } from '@homebell/mocks/native';
import { useServices, useSession } from '@/services/session';
import { Banner, Button, Card, Screen, Text } from '@/ui/components';

/** Mock-mode developer tools: switch scenarios (resets mock data), list demo phones. */
export default function DeveloperScreen() {
  const { mock } = useServices();
  const { signOut } = useSession();
  const [current, setCurrent] = useState(mock?.currentScenario().id ?? 'default');
  if (!mock)
    return (
      <Screen>
        <Banner tone="info" message="Developer tools are only available in mock mode." />
      </Screen>
    );
  return (
    <Screen testID="developer-screen">
      <Banner
        tone="warning"
        message="Mock mode: data is simulated on this phone. Switching scenario resets the data and signs you out."
      />
      {mock.scenarios.map((s) => (
        <Card
          key={s.id}
          onPress={() => {
            mock.setScenario(s.id);
            setCurrent(s.id);
            void signOut();
          }}
          accessibilityLabel={`Scenario ${s.label}`}
          testID={`scenario-${s.id}`}
        >
          <Text variant="label">
            {current === s.id ? '● ' : ''}
            {s.label}
          </Text>
          <Text variant="muted">{s.description}</Text>
        </Card>
      ))}
      <Card>
        <Text variant="label">Demo phones (code {DEMO.otpCode})</Text>
        {Object.entries(DEMO.phones).map(([k, v]) => (
          <Text key={k} variant="small">
            {v} — {k}
          </Text>
        ))}
        <Text variant="small">
          Invitation: {DEMO.invitationCode} (for {DEMO.phones.invited})
        </Text>
      </Card>
      <Button
        title="Reset mock data"
        variant="secondary"
        onPress={() => {
          mock.reset();
          void signOut();
        }}
      />
    </Screen>
  );
}
