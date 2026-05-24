import { useCallback, useEffect, useState } from 'react';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react';
import {
  accessibilityOutline,
  batteryChargingOutline,
  notificationsOutline,
  refreshOutline,
  settingsOutline,
} from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { hardwareButtonService } from '../services/hardwareButtonService';
import {
  BackgroundPttPermissionStatus,
  getBackgroundPttPermissionStatus,
  openAccessibilitySettings,
  openAppSettings,
  openBatteryOptimizationSettings,
  openNotificationSettings,
} from '../services/permissionsService';
import { HardwareKey, preferencesService } from '../services/preferences/preferencesService';
import './Settings.css';

const defaultBackgroundStatus: BackgroundPttPermissionStatus = {
  supported: false,
  accessibilityEnabled: false,
};

const Settings: React.FC = () => {
  const history = useHistory();
  const [hardwareEnabled, setHardwareEnabled] = useState(false);
  const [detectedKey, setDetectedKey] = useState<HardwareKey | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [backgroundStatus, setBackgroundStatus] =
    useState<BackgroundPttPermissionStatus>(defaultBackgroundStatus);
  const [checkingBackgroundStatus, setCheckingBackgroundStatus] = useState(true);

  const refreshBackgroundStatus = useCallback(async () => {
    setCheckingBackgroundStatus(true);
    try {
      setBackgroundStatus(await getBackgroundPttPermissionStatus());
    } finally {
      setCheckingBackgroundStatus(false);
    }
  }, []);

  useEffect(() => {
    const loadPreferences = async () => {
      const enabled = await preferencesService.getHardwarePttEnabled();
      const key = await preferencesService.getHardwareKey();
      setHardwareEnabled(enabled);
      setDetectedKey(key);
    };
    loadPreferences();
    refreshBackgroundStatus();
  }, [refreshBackgroundStatus]);

  useEffect(() => {
    const handleResume = () => {
      refreshBackgroundStatus();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshBackgroundStatus();
      }
    };

    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshBackgroundStatus]);

  const backgroundStatusLabel = !backgroundStatus.supported
    ? 'Android only'
    : checkingBackgroundStatus
      ? 'Checking'
      : backgroundStatus.accessibilityEnabled
        ? 'Enabled'
        : 'Needs setup';

  const backgroundStatusColor = !backgroundStatus.supported
    ? 'medium'
    : backgroundStatus.accessibilityEnabled
      ? 'success'
      : 'warning';

  const setupDisabled = !backgroundStatus.supported;

  const handleOpenAccessibilitySettings = async () => {
    await openAccessibilitySettings();
  };

  const handleOpenAppSettings = async () => {
    await openAppSettings();
  };

  const handleOpenBatterySettings = async () => {
    await openBatteryOptimizationSettings();
  };

  const handleOpenNotificationSettings = async () => {
    await openNotificationSettings();
  };

  const handleToggle = async (enabled: boolean) => {
    setHardwareEnabled(enabled);
    await hardwareButtonService.setEnabled(enabled);
  };

  const handleDetect = async () => {
    setDetecting(true);
    const key = await hardwareButtonService.detectNextKey();
    setDetectedKey(key);
    setDetecting(false);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/home" text="Back" />
          </IonButtons>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="page-content">
        <div className="settings-container">
          <IonText className="settings-title">
            <h1>Settings</h1>
            <p>Configure your push-to-talk hardware button.</p>
          </IonText>

          <div className="settings-actions">
            <IonItem lines="none" className="settings-item">
              <IonLabel>
                <h2>Hardware Push-to-Talk</h2>
                <p>Enable a physical button to start talking.</p>
              </IonLabel>
              <IonToggle checked={hardwareEnabled} onIonChange={(e) => handleToggle(e.detail.checked)} />
            </IonItem>

            <IonButton
              expand="block"
              className="detect-button"
              onClick={handleDetect}
              disabled={!hardwareEnabled || detecting}
            >
              {detecting ? 'Press the hardware button...' : 'Detect Hardware Button'}
            </IonButton>

            <IonText className="detected-key">
              Detected key: {detectedKey ? `${detectedKey.code} (${detectedKey.key})` : 'Not set'}
            </IonText>

            <IonNote className="settings-note">
              Some rugged phones only allow side buttons to launch the app and do not emit a key event.
              If the key triggers a normal keydown event while WaveLink is open, it can be mapped here.
              On Oukitel WP60, the Smart Key may launch WaveLink; if it emits a key event while the app
              is open, you can map it as push-to-talk.
            </IonNote>

            <IonText className="settings-section-title">
              <h2>Background and Locked Screen</h2>
              <p>Keep room audio active and use a mapped hardware button when WaveLink is not on screen.</p>
            </IonText>

            <IonItem lines="none" className="settings-item">
              <IonLabel>
                <h2>Background Key Capture</h2>
                <p>WaveLink Hardware PTT accessibility service</p>
              </IonLabel>
              <IonBadge className="settings-permission-badge" color={backgroundStatusColor}>
                {backgroundStatusLabel}
              </IonBadge>
            </IonItem>

            <div className="settings-permission-actions">
              <IonButton
                expand="block"
                className="settings-permission-button"
                onClick={handleOpenAccessibilitySettings}
                disabled={setupDisabled}
              >
                <IonIcon slot="start" icon={accessibilityOutline} />
                Accessibility Settings
              </IonButton>

              <IonButton
                expand="block"
                fill="outline"
                className="settings-permission-button"
                onClick={handleOpenAppSettings}
              >
                <IonIcon slot="start" icon={settingsOutline} />
                App Permissions
              </IonButton>

              <IonButton
                expand="block"
                fill="outline"
                className="settings-permission-button"
                onClick={handleOpenNotificationSettings}
                disabled={setupDisabled}
              >
                <IonIcon slot="start" icon={notificationsOutline} />
                Notification Settings
              </IonButton>

              <IonButton
                expand="block"
                fill="outline"
                className="settings-permission-button"
                onClick={handleOpenBatterySettings}
                disabled={setupDisabled}
              >
                <IonIcon slot="start" icon={batteryChargingOutline} />
                Battery Settings
              </IonButton>

              <IonButton
                expand="block"
                fill="clear"
                className="settings-permission-button"
                onClick={refreshBackgroundStatus}
              >
                <IonIcon slot="start" icon={refreshOutline} />
                Refresh Status
              </IonButton>
            </div>

            <IonNote className="settings-note">
              Background talking requires Hardware Push-to-Talk, a detected button, microphone access,
              and the accessibility service. A powered-off phone cannot keep a voice room active.
            </IonNote>

            <IonButton expand="block" fill="clear" onClick={() => history.push('/home')}>
              Back to Home
            </IonButton>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Settings;
