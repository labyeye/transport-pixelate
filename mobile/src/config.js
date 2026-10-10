// Point this at your API. 10.0.2.2 reaches the host machine from the Android emulator;
// iOS simulator can use localhost. Override at build time by editing this file or via the Server field on the login screen.
import { Platform } from 'react-native';

export const DEFAULT_API_URL = Platform.select({
  android: 'http://10.0.2.2:5100/api/v1',
  default: 'http://localhost:5100/api/v1',
});
export const POLL_TRIPS_MS = 60000;
export const PING_INTERVAL_MS = 15000;
export const PING_BUFFER_MAX = 1000;
