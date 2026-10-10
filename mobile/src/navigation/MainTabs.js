import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarClock, ClipboardList, Home, MapPin, Menu, Users } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { isCrew } from '../lib/permissions';
import CrewHomeScreen from '../screens/crew/CrewHomeScreen';
import CrewTripsScreen from '../screens/crew/CrewTripsScreen';
import PassengersScreen from '../screens/crew/PassengersScreen';
import ManagerDashboardScreen from '../screens/manager/ManagerDashboardScreen';
import ManagerTripsScreen from '../screens/manager/ManagerTripsScreen';
import LiveVehiclesScreen from '../screens/manager/LiveVehiclesScreen';
import RequestsReviewScreen from '../screens/manager/RequestsReviewScreen';
import MenuScreen from '../screens/shared/MenuScreen';
import { colors, FONT } from '../theme/colors';

const Tab = createBottomTabNavigator();

const tabIcon = Icon => ({ color }) => (
  <View style={styles.iconWrap}><Icon color={color} size={20} strokeWidth={2} /></View>
);

// Tab bar styling copied from NestSports: 2px black top border, uppercase bold labels, blue active tint.
export default function MainTabs() {
  const { user, can } = useAuth();
  const insets = useSafeAreaInsets();
  const crew = isCrew(user);
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: [styles.tabBar, { height: 64 + insets.bottom, paddingBottom: insets.bottom + 4 }],
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      {crew ? (
        <>
          <Tab.Screen name="Home" component={CrewHomeScreen} options={{ tabBarIcon: tabIcon(Home) }} />
          <Tab.Screen name="Trips" component={CrewTripsScreen} options={{ tabBarIcon: tabIcon(CalendarClock) }} />
          <Tab.Screen name="Passengers" component={PassengersScreen} options={{ tabBarIcon: tabIcon(Users) }} />
        </>
      ) : (
        <>
          <Tab.Screen name="Home" component={ManagerDashboardScreen} options={{ tabBarIcon: tabIcon(Home) }} />
          {can('trips:read') ? <Tab.Screen name="Trips" component={ManagerTripsScreen} options={{ tabBarIcon: tabIcon(CalendarClock) }} /> : null}
          {can('tracking:read') ? <Tab.Screen name="Live" component={LiveVehiclesScreen} options={{ tabBarLabel: 'Live', tabBarIcon: tabIcon(MapPin) }} /> : null}
          {can('requests:review') ? <Tab.Screen name="Review" component={RequestsReviewScreen} options={{ tabBarLabel: 'Requests', tabBarIcon: tabIcon(ClipboardList) }} /> : null}
        </>
      )}
      <Tab.Screen name="Menu" component={MenuScreen} options={{ tabBarLabel: 'More', tabBarIcon: tabIcon(Menu) }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: { overflow: 'hidden', borderTopWidth: 2, borderTopColor: colors.black, backgroundColor: colors.white, paddingTop: 4 },
  tabLabel: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  iconWrap: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
});
