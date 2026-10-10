import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme/colors';

// Blue band with a wavy white edge above the auth screens' title (same artwork as NestSports).
export default function AuthBanner() {
  return (
    <View style={styles.banner}>
      <Svg width="100%" height="100%" viewBox="0 0 400 140" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Circle cx={330} cy={40} r={70} fill="#FFFFFF" fillOpacity={0.1} />
        <Circle cx={60} cy={20} r={45} fill="#FFFFFF" fillOpacity={0.08} />
        <Circle cx={200} cy={110} r={35} fill="#FFFFFF" fillOpacity={0.06} />
      </Svg>
      <Svg width="100%" height={56} viewBox="0 0 400 56" preserveAspectRatio="none" style={styles.wave}>
        <Path d="M0 56 L0 30 C90 -8 170 62 260 28 C310 10 360 6 400 20 L400 56 Z" fill={colors.white} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { height: 140, backgroundColor: colors.blue, overflow: 'hidden' },
  wave: { position: 'absolute', left: 0, right: 0, bottom: -1 },
});
