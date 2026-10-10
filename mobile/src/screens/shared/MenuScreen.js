import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Grid, LogOut as LogOutIcon, User } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { menuGroupsFor } from '../../navigation/navConfig';
import { colors, FONT } from '../../theme/colors';
import { titleCase } from '../../lib/format';

// Same anatomy as NestSports' MenuScreen: title bar, user strip with Edit/Logout, grouped list cards.
export default function MenuScreen({ navigation }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  const groups = menuGroupsFor(user);
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Grid size={20} color={colors.blue} />
          <Text style={styles.headerTitle}>More</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.userStrip} onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{user.name?.[0]?.toUpperCase() ?? 'U'}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
          <Text style={styles.role}>{titleCase(user.role).toUpperCase()}</Text>
        </View>
        <View style={styles.editBtn}><User size={14} color={colors.blue} /><Text style={styles.editBtnText}>Edit</Text></View>
        <TouchableOpacity style={styles.logoutBtn} onPress={logout} accessibilityLabel="Log out">
          <LogOutIcon size={16} color={colors.red} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </TouchableOpacity>
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
        {groups.map(group => (
          <View key={group.label} style={{ marginBottom: 18 }}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.groupCard}>
              {group.items.map((item, i) => (
                <TouchableOpacity key={item.screen} style={[styles.item, i < group.items.length - 1 && styles.itemBorder]} onPress={() => navigation.navigate(item.screen)} activeOpacity={0.7}>
                  <View style={styles.itemIconWrap}><item.icon size={18} color={colors.blue} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemText}>{item.title}</Text>
                    <Text style={styles.itemDesc}>{item.desc}</Text>
                  </View>
                  <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <Text style={styles.version}>Nest Transport v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.black },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontFamily: FONT.bold, fontSize: 20, fontWeight: '800', color: colors.black },
  userStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderBottomWidth: 2, borderBottomColor: colors.black, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  avatar: { width: 44, height: 44, borderWidth: 2, borderRadius: 8, borderColor: colors.black, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontFamily: FONT.bold, fontWeight: '800', fontSize: 18 },
  name: { fontFamily: FONT.bold, fontWeight: '800', fontSize: 15, color: colors.black },
  role: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.5, marginTop: 2 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 2, borderRadius: 8, borderColor: colors.blue, paddingHorizontal: 8, paddingVertical: 6 },
  editBtnText: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', color: colors.blue, textTransform: 'uppercase' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 2, borderRadius: 8, borderRightWidth: 5, borderBottomWidth: 5, borderRightColor: '#0A0A0A', borderBottomColor: '#0A0A0A', borderColor: colors.red, paddingHorizontal: 10, paddingVertical: 6 },
  logoutText: { fontFamily: FONT.bold, fontSize: 12, fontWeight: '700', color: colors.red, textTransform: 'uppercase' },
  groupLabel: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  groupCard: { borderWidth: 2, borderRadius: 8, borderRightWidth: 5, borderBottomWidth: 5, borderRightColor: '#0A0A0A', borderBottomColor: '#0A0A0A', borderColor: colors.black, backgroundColor: colors.white, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: '#0000001A' },
  itemIconWrap: { width: 36, height: 36, borderWidth: 2, borderRadius: 8, borderColor: colors.blue, backgroundColor: `${colors.blue}12`, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontFamily: FONT.bold, fontSize: 14, fontWeight: '700', color: colors.black },
  itemDesc: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted, marginTop: 1 },
  version: { fontFamily: FONT.medium, textAlign: 'center', color: colors.muted, fontSize: 11, marginTop: 4 },
});
