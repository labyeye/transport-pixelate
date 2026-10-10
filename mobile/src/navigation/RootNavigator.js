import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../contexts/AuthContext';
import { SyncProvider } from '../contexts/SyncContext';
import { TripsProvider } from '../contexts/TripsContext';
import { isCrew } from '../lib/permissions';
import AnimatedSplash from '../components/AnimatedSplash';
import BackBar from '../components/BackBar';
import MainTabs from './MainTabs';
import LoginScreen from '../screens/auth/LoginScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import TripDetailScreen from '../screens/crew/TripDetailScreen';
import ManagerTripScreen from '../screens/manager/ManagerTripScreen';
import LiveVehiclesScreen from '../screens/manager/LiveVehiclesScreen';
import RequestsReviewScreen from '../screens/manager/RequestsReviewScreen';
import OutstandingScreen from '../screens/manager/OutstandingScreen';
import { DriversScreen, VehiclesScreen } from '../screens/manager/FleetScreens';
import NotificationsScreen from '../screens/shared/NotificationsScreen';
import ProfileScreen from '../screens/shared/ProfileScreen';
import SettingsScreen from '../screens/shared/SettingsScreen';
import ContactsScreen from '../screens/shared/ContactsScreen';
import MyRequestsScreen from '../screens/shared/MyRequestsScreen';
import NewRequestScreen from '../screens/shared/NewRequestScreen';

const Stack = createNativeStackNavigator();
const withBack = { header: props => <BackBar {...props} /> };

function SignedIn() {
  const { user } = useAuth();
  const crew = isCrew(user);
  const stack = (
    <NavigationContainer>
      <Stack.Navigator screenOptions={withBack}>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Trip" component={TripDetailScreen} />
        <Stack.Screen name="ManagerTrip" component={ManagerTripScreen} />
        <Stack.Screen name="LiveVehicles" component={LiveVehiclesScreen} />
        <Stack.Screen name="RequestsReview" component={RequestsReviewScreen} />
        <Stack.Screen name="Vehicles" component={VehiclesScreen} />
        <Stack.Screen name="Drivers" component={DriversScreen} />
        <Stack.Screen name="Outstanding" component={OutstandingScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Contacts" component={ContactsScreen} />
        <Stack.Screen name="MyRequests" component={MyRequestsScreen} />
        <Stack.Screen name="NewRequest" component={NewRequestScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
  // Crew need trips, offline sync and tracking; managers use plain online screens.
  return <SyncProvider>{crew ? <TripsProvider>{stack}</TripsProvider> : stack}</SyncProvider>;
}

function SignedOut() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();
  const [splash, setSplash] = useState(true);
  const done = useCallback(() => setSplash(false), []);
  return (
    <View style={{ flex: 1 }}>
      {!loading ? (user ? <SignedIn /> : <SignedOut />) : null}
      {splash ? <AnimatedSplash ready={!loading} onFinish={done} /> : null}
    </View>
  );
}
