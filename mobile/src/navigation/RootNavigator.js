import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import { SyncProvider } from '../contexts/SyncContext';
import { TripsProvider } from '../contexts/TripsContext';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import TripScreen from '../screens/TripScreen';
import MoreScreen from '../screens/MoreScreen';
import { ManagerOverview, ManagerRequests } from '../screens/ManagerScreens';
import { colors, FONT } from '../theme';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const header = { headerStyle: { backgroundColor: colors.blue }, headerTintColor: colors.white, headerTitleStyle: { fontFamily: FONT.bold } };
const tabOpts = { ...header, tabBarActiveTintColor: colors.blue, tabBarLabelStyle: { fontFamily: FONT.bold, fontSize: 12 }, tabBarStyle: { borderTopWidth: 2, borderTopColor: colors.black } };

const CrewTabs = () => (
  <Tabs.Navigator screenOptions={tabOpts}>
    <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'My trips' }} />
    <Tabs.Screen name="More" component={MoreScreen} />
  </Tabs.Navigator>
);

const ManagerTabs = () => (
  <Tabs.Navigator screenOptions={tabOpts}>
    <Tabs.Screen name="Overview" component={ManagerOverview} />
    <Tabs.Screen name="Requests" component={ManagerRequests} />
    <Tabs.Screen name="More" component={MoreScreen} />
  </Tabs.Navigator>
);

const CREW = ['driver', 'attendant'];

export default function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={colors.blue} /></View>;
  if (!user) return <NavigationContainer><Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Login" component={LoginScreen} /></Stack.Navigator></NavigationContainer>;
  const crew = CREW.includes(user.role);
  const tree = (
    <NavigationContainer>
      <Stack.Navigator screenOptions={header}>
        <Stack.Screen name="Main" component={crew ? CrewTabs : ManagerTabs} options={{ title: 'Nest Transport', headerShown: false }} />
        <Stack.Screen name="Trip" component={TripScreen} options={{ title: 'Trip' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
  // Crew need trips, sync and tracking; managers use plain online screens.
  return (
    <SyncProvider>
      {crew ? <TripsProvider>{tree}</TripsProvider> : tree}
    </SyncProvider>
  );
}
