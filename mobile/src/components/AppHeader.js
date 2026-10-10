import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bell } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useApi } from '../lib/useApi';
import { Avatar } from './ui';
import { colors, FONT } from '../theme/colors';

// Logo on the left; notifications bell with unread count and the user's avatar on the right (NestSports dashboard header).
export default function AppHeader() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const { data } = useApi('/notifications/unread-count', undefined, { interval: 60000 });
  const unread = data?.count ?? 0;
  return (
    <View style={styles.header}>
      <Image source={require('../assets/logo_long.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Nest Transport" />
      <View style={styles.right}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Notifications')} accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell size={18} color={colors.black} strokeWidth={2.5} />
          {unread > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
          ) : null}
        </TouchableOpacity>
        <Avatar name={user?.name} size={38} onPress={() => navigation.navigate('Profile')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 },
  logo: { width: 146, height: 53 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.black, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.orange, borderWidth: 1.5, borderColor: colors.black, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontFamily: FONT.bold, fontSize: 10, color: colors.white, fontWeight: '800' },
});
