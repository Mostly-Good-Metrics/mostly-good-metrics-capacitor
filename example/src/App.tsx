import { useEffect, useState } from 'react';
import {
  IonApp,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonAlert,
  setupIonicReact,
} from '@ionic/react';
import MostlyGoodMetrics from '@mostly-good-metrics/capacitor';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

setupIonicReact();

const API_KEY_STORAGE_KEY = 'mgm_example_api_key';

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Load saved API key on mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);

  const configureSDK = () => {
    if (!apiKey.trim()) {
      showAlert('Please enter an API key');
      return;
    }

    // Save API key for next time
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());

    // Initialize the SDK
    MostlyGoodMetrics.configure(apiKey.trim(), {
      appVersion: '1.0.0',
      enableDebugLogging: true,
    });

    setIsConfigured(true);
    showAlert('SDK configured successfully!');
  };

  const resetSDK = () => {
    MostlyGoodMetrics.destroy();
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey('');
    setIsConfigured(false);
    setEventCount(0);
    showAlert('SDK reset. Enter a new API key to continue.');
  };

  const showAlert = (message: string) => {
    setAlertMessage(message);
  };

  const trackEvent = () => {
    const count = eventCount + 1;
    setEventCount(count);
    MostlyGoodMetrics.track('button_pressed', {
      button_name: 'track_event',
      press_count: count,
    });
    showAlert(`Tracked: button_pressed (count: ${count})`);
  };

  const trackPurchase = () => {
    MostlyGoodMetrics.track('purchase_completed', {
      product_id: 'sku_123',
      price: 29.99,
      currency: 'USD',
    });
    showAlert('Tracked: purchase_completed');
  };

  const trackSignUp = () => {
    MostlyGoodMetrics.track('sign_up_completed', {
      method: 'email',
      referral_source: 'organic',
    });
    showAlert('Tracked: sign_up_completed');
  };

  const trackAddToCart = () => {
    MostlyGoodMetrics.track('add_to_cart', {
      product_id: 'prod_456',
      product_name: 'Premium Widget',
      quantity: 1,
      price: 49.99,
    });
    showAlert('Tracked: add_to_cart');
  };

  const trackSearch = () => {
    MostlyGoodMetrics.track('search_performed', {
      query: 'capacitor analytics',
      results_count: 42,
      filters_applied: ['category', 'price'],
    });
    showAlert('Tracked: search_performed');
  };

  const trackFeatureUsed = () => {
    MostlyGoodMetrics.track('feature_used', {
      feature_name: 'dark_mode',
      enabled: true,
      source: 'settings',
    });
    showAlert('Tracked: feature_used');
  };

  const flushEvents = async () => {
    MostlyGoodMetrics.flush();
    const count = await MostlyGoodMetrics.getPendingEventCount();
    showAlert(`Flushed! Pending events: ${count}`);
  };

  return (
    <IonApp>
      <IonHeader>
        <IonToolbar>
          <IonTitle>MostlyGoodMetrics</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h2>Capacitor Example</h2>
          <p style={{ color: '#666' }}>
            {isConfigured ? 'Tap buttons to track events' : 'Enter your API key to get started'}
          </p>
        </div>

        {!isConfigured ? (
          <IonList>
            <IonItem>
              <IonInput
                label="API Key"
                labelPlacement="stacked"
                placeholder="mgm_proj_..."
                value={apiKey}
                onIonInput={(e) => setApiKey(e.detail.value ?? '')}
                type="text"
              />
            </IonItem>
            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={configureSDK}>
                  Configure SDK
                </IonButton>
              </IonLabel>
            </IonItem>
          </IonList>
        ) : (
          <IonList>
            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackEvent}>
                  Track Event ({eventCount})
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackPurchase}>
                  Purchase
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackSignUp}>
                  Sign Up
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackAddToCart}>
                  Add to Cart
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackSearch}>
                  Search
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" onClick={trackFeatureUsed}>
                  Feature Used
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" color="success" onClick={flushEvents}>
                  Flush Events
                </IonButton>
              </IonLabel>
            </IonItem>

            <IonItem>
              <IonLabel>
                <IonButton expand="block" color="danger" onClick={resetSDK}>
                  Reset SDK
                </IonButton>
              </IonLabel>
            </IonItem>
          </IonList>
        )}

        <IonAlert
          isOpen={alertMessage !== null}
          onDidDismiss={() => setAlertMessage(null)}
          header="Event"
          message={alertMessage ?? ''}
          buttons={['OK']}
        />
      </IonContent>
    </IonApp>
  );
}
