import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import {
  Canvas,
  Fill,
  FilterMode,
  ImageShader,
  MipmapMode,
  Shader,
  SkImage,
  Skia,
  TileMode,
  useImage,
} from 'react-native-skia';
import { ASTRO_PRESETS, ASTRO_SKSL_SHADER, AstroParams } from './src/astroShader';

function computeAutoParams(img: SkImage): AstroParams {
  try {
    const sampleSize = 64;
    const surface = Skia.Surface.MakeOffscreen(sampleSize, sampleSize);
    if (!surface) return ASTRO_PRESETS[0].params;

    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    canvas.drawImageRect(
      img,
      Skia.XYWHRect(0, 0, img.width(), img.height()),
      Skia.XYWHRect(0, 0, sampleSize, sampleSize),
      paint
    );
    surface.flush();

    const snap = surface.makeImageSnapshot();
    const pixels = snap.readPixels(0, 0);
    if (!pixels) return ASTRO_PRESETS[0].params;

    const lumas: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }

    lumas.sort((a, b) => a - b);
    const p10 = lumas[Math.floor(lumas.length * 0.1)] ?? 0.05;
    const p50 = lumas[Math.floor(lumas.length * 0.5)] ?? 0.15;
    const p95 = lumas[Math.floor(lumas.length * 0.95)] ?? 0.75;

    const isBrightTarget = p50 > 0.32 || (p10 < 0.04 && p95 > 0.78);

    if (isBrightTarget) {
      return {
        stretch: 0.18,
        blackPoint: Math.min(0.08, Math.max(0.01, Number((p10 * 0.7).toFixed(2)))),
        sharpen: 1.05,
        denoise: 0.45,
        vibrance: 0.3,
        starControl: 0.2,
      };
    }

    const autoStretch = Math.min(0.7, Math.max(0.28, Number((0.68 - p50 * 1.4).toFixed(2))));
    const autoBlack = Math.min(0.22, Math.max(0.02, Number((p10 * 0.85).toFixed(2))));

    return {
      stretch: autoStretch,
      blackPoint: autoBlack,
      sharpen: 0.45,
      denoise: 0.75,
      vibrance: 0.42,
      starControl: 0.78,
    };
  } catch {
    return ASTRO_PRESETS[0].params;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AstroEditorScreen />
    </SafeAreaProvider>
  );
}

function AstroEditorScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string>('auto_pro');
  const [params, setParams] = useState<AstroParams>(ASTRO_PRESETS[0].params);
  const [showOriginal, setShowOriginal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [renderTick, setRenderTick] = useState<number>(0);

  // Pinch-to-zoom & pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const gestureStartRef = useRef({
    zoom: 1,
    panX: 0,
    panY: 0,
    pinchDist: 0,
    touchX: 0,
    touchY: 0,
    isPinching: false,
  });

  const skImage = useImage(imageUri);

  useEffect(() => {
    if (skImage) {
      const auto = computeAutoParams(skImage);
      setActivePresetId('auto_pro');
      setParams(auto);
      resetZoom();
      setRenderTick((t) => t + 1);
    }
  }, [skImage]);

  const runtimeEffect = useMemo(() => {
    const effect = Skia.RuntimeEffect.Make(ASTRO_SKSL_SHADER);
    if (!effect) {
      console.error('Failed to compile Astro SkSL shader');
    }
    return effect;
  }, []);

  // Size preview proportionally so top preview + scrollable controls + bottom save bar all fit comfortably
  const canvasDimensions = useMemo(() => {
    const maxWidth = screenWidth - 24;
    const maxHeight = Math.min(310, Math.round(screenHeight * 0.36));
    if (!skImage) {
      return { width: maxWidth, height: Math.min(260, maxHeight), nativeScaleRatio: 1 };
    }
    const imgW = skImage.width();
    const imgH = skImage.height();
    const fitScale = Math.min(maxWidth / imgW, maxHeight / imgH);
    return {
      width: Math.round(imgW * fitScale),
      height: Math.round(imgH * fitScale),
      nativeScaleRatio: Math.max(1, 1 / fitScale),
    };
  }, [skImage, screenWidth, screenHeight]);

  const maxZoom = useMemo(() => {
    return Math.max(4, Number((canvasDimensions.nativeScaleRatio * 1.5).toFixed(2)));
  }, [canvasDimensions.nativeScaleRatio]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const maxOffsetX = ((z - 1) * canvasDimensions.width) / 2;
      const maxOffsetY = ((z - 1) * canvasDimensions.height) / 2;
      return {
        x: Math.min(maxOffsetX, Math.max(-maxOffsetX, x)),
        y: Math.min(maxOffsetY, Math.max(-maxOffsetY, y)),
      };
    },
    [canvasDimensions.width, canvasDimensions.height]
  );

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomToNative100 = useCallback(() => {
    const target = Math.min(maxZoom, Math.max(1, canvasDimensions.nativeScaleRatio));
    zoomRef.current = target;
    panRef.current = { x: 0, y: 0 };
    setZoom(target);
    setPan({ x: 0, y: 0 });
  }, [canvasDimensions.nativeScaleRatio, maxZoom]);

  const getTouchDistance = (touches: readonly { pageX: number; pageY: number }[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.hypot(dx, dy);
  };

  const viewportPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2 || gs.numberActiveTouches >= 2,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const touches = evt.nativeEvent.touches;
          gestureStartRef.current = {
            zoom: zoomRef.current,
            panX: panRef.current.x,
            panY: panRef.current.y,
            pinchDist: touches.length >= 2 ? getTouchDistance(touches) : 0,
            touchX: touches[0]?.pageX ?? 0,
            touchY: touches[0]?.pageY ?? 0,
            isPinching: touches.length >= 2,
          };
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            const dist = getTouchDistance(touches);
            if (!gestureStartRef.current.isPinching || gestureStartRef.current.pinchDist === 0) {
              gestureStartRef.current.isPinching = true;
              gestureStartRef.current.pinchDist = dist;
              gestureStartRef.current.zoom = zoomRef.current;
              return;
            }
            const ratio = dist / gestureStartRef.current.pinchDist;
            const nextZoom = Math.min(maxZoom, Math.max(1, gestureStartRef.current.zoom * ratio));
            const nextPan = clampPan(panRef.current.x, panRef.current.y, nextZoom);
            zoomRef.current = nextZoom;
            panRef.current = nextPan;
            setZoom(nextZoom);
            setPan(nextPan);
          } else if (touches.length === 1 && !gestureStartRef.current.isPinching) {
            if (zoomRef.current <= 1.01) return;
            const dx = touches[0].pageX - gestureStartRef.current.touchX;
            const dy = touches[0].pageY - gestureStartRef.current.touchY;
            const nextPan = clampPan(
              gestureStartRef.current.panX + dx,
              gestureStartRef.current.panY + dy,
              zoomRef.current
            );
            panRef.current = nextPan;
            setPan(nextPan);
          }
        },
        onPanResponderRelease: () => {
          gestureStartRef.current.isPinching = false;
        },
      }),
    [clampPan, maxZoom]
  );

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please grant photo library access to load astrophotos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const applyPreset = useCallback(
    (presetId: string) => {
      if (presetId === 'auto_pro' && skImage) {
        setActivePresetId('auto_pro');
        setParams(computeAutoParams(skImage));
        setShowOriginal(false);
        setRenderTick((t) => t + 1);
        return;
      }
      const found = ASTRO_PRESETS.find((p) => p.id === presetId);
      if (found) {
        setActivePresetId(found.id);
        setParams({ ...found.params });
        setShowOriginal(false);
        setRenderTick((t) => t + 1);
      }
    },
    [skImage]
  );

  const updateParamValue = useCallback((key: keyof AstroParams, newVal: number) => {
    setActivePresetId('custom');
    setShowOriginal(false);
    setParams((prev) => ({
      ...prev,
      [key]: Number(newVal.toFixed(2)),
    }));
    setRenderTick((t) => t + 1);
  }, []);

  const exportFullResolution = async () => {
    if (!skImage || !runtimeEffect) return;

    let step = 'init';
    try {
      setIsSaving(true);

      step = 'requestPermissions';
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Allow photo library access to save your enhanced image.');
        setIsSaving(false);
        return;
      }

      const fullW = skImage.width();
      const fullH = skImage.height();

      step = 'makeOffscreenSurface';
      const surface = Skia.Surface.MakeOffscreen(fullW, fullH);
      if (!surface) {
        throw new Error('Could not allocate offscreen GPU surface');
      }

      step = 'makeImageShader';
      const imgShader = skImage.makeShaderOptions(
        TileMode.Clamp,
        TileMode.Clamp,
        FilterMode.Linear,
        MipmapMode.None
      );

      step = 'makeRuntimeShader';
      const uniformValues = [
        fullW,
        fullH,
        params.stretch,
        params.blackPoint,
        params.sharpen,
        params.denoise,
        params.vibrance,
        params.starControl,
      ];

      const finalShader = runtimeEffect.makeShaderWithChildren(uniformValues, [imgShader]);

      step = 'drawToCanvas';
      const canvas = surface.getCanvas();
      const paint = Skia.Paint();
      paint.setShader(finalShader);

      canvas.drawRect(Skia.XYWHRect(0, 0, fullW, fullH), paint);
      surface.flush();

      step = 'encodeSnapshot';
      const snapshot = surface.makeImageSnapshot();
      const pngBytes = await Promise.resolve(snapshot.encodeToBytes());

      step = 'writeFile';
      const outFile = new File(Paths.cache, `astro_enhanced_${Date.now()}.png`);
      outFile.write(pngBytes);

      step = 'saveToLibrary';
      await MediaLibrary.saveToLibraryAsync(outFile.uri);
      Alert.alert('Saved', `Full-resolution (${fullW}x${fullH}) astrophoto saved to your gallery.`);
    } catch (err) {
      Alert.alert(
        'Export Error',
        `Failed at [${step}]: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const originalPreset = ASTRO_PRESETS[ASTRO_PRESETS.length - 1];
  const activeParams = showOriginal ? originalPreset.params : params;

  const uniforms = {
    resolution: [canvasDimensions.width, canvasDimensions.height],
    stretch: activeParams.stretch,
    blackPoint: activeParams.blackPoint,
    sharpen: activeParams.sharpen,
    denoise: activeParams.denoise,
    vibrance: activeParams.vibrance,
    starControl: activeParams.starControl,
  };

  const zoomPercent = skImage
    ? Math.round((zoom / canvasDimensions.nativeScaleRatio) * 100)
    : 100;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor="#070A12" />

      {/* PINNED TOP: Header + Live Preview Viewport */}
      <View style={styles.pinnedTop}>
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.title}>AstroEnhancer</Text>
            <Text style={styles.subtitle}>Natural Deep-Sky, Solar, Lunar & Planetary Processor</Text>
          </View>
          <Pressable style={styles.primaryBtn} onPress={pickImage}>
            <Text style={styles.primaryBtnText}>{imageUri ? 'Change Photo' : 'Open Photo'}</Text>
          </Pressable>
        </View>

        <View style={[styles.canvasContainer, { height: canvasDimensions.height + (skImage ? 38 : 0) }]}>
          {skImage && runtimeEffect ? (
            <>
              <View
                {...viewportPanResponder.panHandlers}
                style={[
                  styles.viewportClip,
                  { width: canvasDimensions.width, height: canvasDimensions.height },
                ]}
              >
                <View
                  style={{
                    width: canvasDimensions.width,
                    height: canvasDimensions.height,
                    transform: [
                      { translateX: pan.x },
                      { translateY: pan.y },
                      { scale: zoom },
                    ],
                  }}
                >
                  <Canvas
                    key={`canvas-${renderTick}-${showOriginal ? 'orig' : 'edit'}`}
                    style={{ width: canvasDimensions.width, height: canvasDimensions.height }}
                  >
                    <Fill>
                      <Shader source={runtimeEffect} uniforms={uniforms}>
                        <ImageShader
                          image={skImage}
                          fit="contain"
                          rect={{
                            x: 0,
                            y: 0,
                            width: canvasDimensions.width,
                            height: canvasDimensions.height,
                          }}
                        />
                      </Shader>
                    </Fill>
                  </Canvas>
                </View>
              </View>

              <View style={styles.viewportBar}>
                <Pressable
                  style={[styles.barChip, showOriginal && styles.barChipWarn]}
                  onPress={() => {
                    setShowOriginal((v) => !v);
                    setRenderTick((t) => t + 1);
                  }}
                >
                  <Text style={styles.barChipText}>
                    {showOriginal ? 'Showing: Raw' : 'Compare Raw'}
                  </Text>
                </Pressable>

                <View style={styles.zoomGroup}>
                  <Pressable style={styles.barChip} onPress={zoomToNative100}>
                    <Text style={styles.barChipText}>100% Native ({zoomPercent}%)</Text>
                  </Pressable>
                  {zoom > 1.02 && (
                    <Pressable style={[styles.barChip, { marginLeft: 6 }]} onPress={resetZoom}>
                      <Text style={styles.barChipText}>Fit</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </>
          ) : (
            <Pressable style={styles.emptyState} onPress={pickImage}>
              <Text style={styles.emptyTitle}>Tap to Load Astrophoto</Text>
              <Text style={styles.emptyDesc}>
                Pinch to zoom up to full native resolution • Dedicated profiles for Nebula, Galaxies, Moon, Sun & Planets
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* MIDDLE SCROLLABLE AREA: Presets & Fine-Tune Sliders */}
      {skImage ? (
        <>
          <ScrollView
            style={styles.middleScroll}
            contentContainerStyle={styles.middleScrollContent}
          >
            <Text style={styles.sectionTitle}>Enhancement Profiles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {ASTRO_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id && !showOriginal;
                return (
                  <Pressable
                    key={preset.id}
                    style={[styles.presetCard, isSelected && styles.presetCardActive]}
                    onPress={() => applyPreset(preset.id)}
                  >
                    <Text style={[styles.presetName, isSelected && styles.presetNameActive]}>
                      {preset.name}
                    </Text>
                    <Text style={styles.presetDesc}>{preset.description}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionTitle}>Fine-Tune Pipeline</Text>
            <View style={styles.controlsCard}>
              <SliderRow
                label="Detail Stretch (Faint Gas & Dust)"
                value={params.stretch}
                min={0}
                max={1}
                onChange={(v) => updateParamValue('stretch', v)}
              />
              <SliderRow
                label="Sky Background Floor"
                value={params.blackPoint}
                min={0}
                max={0.35}
                onChange={(v) => updateParamValue('blackPoint', v)}
              />
              <SliderRow
                label="Star Control & White Cores"
                value={params.starControl}
                min={0}
                max={1}
                onChange={(v) => updateParamValue('starControl', v)}
              />
              <SliderRow
                label="Structure & Surface Sharpen"
                value={params.sharpen}
                min={0}
                max={1.5}
                onChange={(v) => updateParamValue('sharpen', v)}
              />
              <SliderRow
                label="Natural Midtone Color"
                value={params.vibrance}
                min={0}
                max={1.5}
                onChange={(v) => updateParamValue('vibrance', v)}
              />
              <SliderRow
                label="Hot-Pixel & Chroma Denoise"
                value={params.denoise}
                min={0}
                max={1}
                isLast
                onChange={(v) => updateParamValue('denoise', v)}
              />
            </View>
          </ScrollView>

          {/* PINNED BOTTOM: Save Full-Resolution Button */}
          <View style={[styles.pinnedBottom, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
            <Pressable
              style={[styles.exportBtn, isSaving && styles.exportBtnDisabled]}
              onPress={exportFullResolution}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="#0B0F19" />
              ) : (
                <Text style={styles.exportBtnText}>
                  Save Full-Resolution Image ({skImage.width()}x{skImage.height()})
                </Text>
              )}
            </Pressable>
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  isLast = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  isLast?: boolean;
  onChange: (val: number) => void;
}) {
  const trackWidthRef = useRef(1);
  const startRatioRef = useRef(0);

  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const updateFromRatio = useCallback(
    (r: number) => {
      const clamped = Math.min(1, Math.max(0, r));
      const mapped = min + clamped * (max - min);
      onChange(mapped);
    },
    [min, max, onChange]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touchX = evt.nativeEvent.locationX;
          const clickedRatio = touchX / Math.max(1, trackWidthRef.current);
          startRatioRef.current = clickedRatio;
          updateFromRatio(clickedRatio);
        },
        onPanResponderMove: (_, gs) => {
          const deltaRatio = gs.dx / Math.max(1, trackWidthRef.current);
          updateFromRatio(startRatioRef.current + deltaRatio);
        },
      }),
    [updateFromRatio]
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };

  return (
    <View style={[styles.sliderRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.sliderHeader}>
        <Text style={styles.controlLabel}>{label}</Text>
        <Text style={styles.stepVal}>{Math.round(ratio * 100)}%</Text>
      </View>
      <View
        style={styles.sliderTouchArea}
        onLayout={onTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
        </View>
        <View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070A12',
  },
  pinnedTop: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#070A12',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  primaryBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  canvasContainer: {
    backgroundColor: '#0D1322',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  viewportClip: {
    overflow: 'hidden',
    backgroundColor: '#05070D',
  },
  viewportBar: {
    width: '100%',
    height: 38,
    paddingHorizontal: 10,
    backgroundColor: '#0B111E',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  barChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  barChipWarn: {
    backgroundColor: '#7C2D12',
  },
  barChipText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyState: {
    padding: 28,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyDesc: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  middleScroll: {
    flex: 1,
  },
  middleScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 20,
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  presetRow: {
    marginBottom: 16,
  },
  presetCard: {
    width: 150,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 10,
    marginRight: 10,
  },
  presetCardActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#132238',
  },
  presetName: {
    color: '#F1F5F9',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 3,
  },
  presetNameActive: {
    color: '#38BDF8',
  },
  presetDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 14,
  },
  controlsCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  sliderRow: {
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  controlLabel: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  stepVal: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 12,
  },
  sliderTouchArea: {
    height: 26,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
  },
  sliderThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F8FAFC',
    borderWidth: 2.5,
    borderColor: '#38BDF8',
    marginLeft: -9,
  },
  pinnedBottom: {
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: '#070A12',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  exportBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  exportBtnDisabled: {
    opacity: 0.6,
  },
  exportBtnText: {
    color: '#070A12',
    fontWeight: '700',
    fontSize: 15,
  },
});
