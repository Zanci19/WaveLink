import { useEffect, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { hardwareButtonService } from '../services/hardwareButtonService';
import { HardwareKey, preferencesService } from '../services/preferences/preferencesService';
import './Settings.css';

const Settings: React.FC = () => {
  const history = useHistory();
  const [hardwareEnabled, setHardwareEnabled] = useState(false);
  const [detectedKey, setDetectedKey] = useState<HardwareKey | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      const enabled = await preferencesService.getHardwarePttEnabled();
      const key = await preferencesService.getHardwareKey();
      setHardwareEnabled(enabled);
      setDetectedKey(key);
    };
    loadPreferences();
  }, []);

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
