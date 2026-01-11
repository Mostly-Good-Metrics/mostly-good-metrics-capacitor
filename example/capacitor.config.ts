import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mostlygoodmetrics.example',
  appName: 'MGM Capacitor Example',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
