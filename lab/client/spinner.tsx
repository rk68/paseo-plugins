import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";

const TURN_MS = 1000;

/** A rotating status icon for work in progress; static when the system asks for reduced motion. */
export function Spinner({ size, color }: { size: number; color: string }) {
  const turn = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: TURN_MS,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn, reduceMotion]);

  const style = useMemo(
    () => ({
      transform: [
        { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
      ],
    }),
    [turn],
  );
  if (reduceMotion) return <Icon name="LoaderCircle" size={size} color={color} />;
  return (
    <Animated.View style={style}>
      <Icon name="LoaderCircle" size={size} color={color} />
    </Animated.View>
  );
}
