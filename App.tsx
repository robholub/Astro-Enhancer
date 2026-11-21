import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
    const p10 = lumas[Math.floor(lumas.length * 0.1)] ?? 0.05;   // Background sky level
    const p50 = lumas[Math.floor(lumas.length * 0.5)] ?? 0.15;   // Median subject brightness
    const p95 = lumas[Math.floor(lumas.length * 0.95)] ?? 0.75;  // Highlights

    // Bright planetary/lunar/solar frames have high p95 and low background or high median
    const isBrightTarget = p50 > 0.32 || (p10 < 0.04 && p95 > 0.78);

    if (isBrightTarget) {
      // Moon, Sun, or bright planet: gentle stretch, strong crisp detail, protect highlights
      return {
        stretch: 0.18,
        blackPoint: Math.min(0.08, Math.max(0.01, Number((p10 * 0.7).toFixed(2)))),
        sharpen: 0.95,
        denoise: 0.3,
        vibrance: 0.3,
        starControl: 0.35,
      };
    }

    // Deep sky (nebula, galaxy, star cluster): adapt stretch to how dark the midtones are
    const autoStretch = Math.min(0.75, Math.max(0.28, Number((0.72 - p50 * 1.4).toFixed(2))));
    const autoBlack = Math.min(0.22, Math.max(0.02, Number((p10 * 0.85).toFixed(2))));

    return {
      stretch: autoStretch,
      blackPoint: autoBlack,
      sharpen: 0.45,
      denoise: 0.5,
      vibrance: 0.5,
      starControl: 0.75,
    };
  } catch {
    return ASTRO_PRESETS[0].params;
  }
}

export default function App() {
  const { width: screenWidth } = useWindowDimensions();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string>('auto_pro');
  const [params, setParams] = useState<AstroParams>(ASTRO_PRESETS[0].params);
  const [showOriginal, setShowOriginal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [renderTick, setRenderTick] = useState<number>(0);

  const skImage = useImage(imageUri);

  // Run automatic histogram analysis whenever a new photo finishes loading
  useEffect(() => {
    if (skImage) {
      const auto = computeAutoParams(skImage);
      setActivePresetId('auto_pro');
      setParams(auto);
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

  const canvasDimensions = useMemo(() => {
    const maxWidth = screenWidth - 32;
    const maxHeight = 420;
    if (!skImage) {
      return { width: maxWidth, height: 320 };
    }
    const imgW = skImage.width();
    const imgH = skImage.height();
    const scale = Math.min(maxWidth / imgW, maxHeight / imgH);
    return {
      width: Math.round(imgW * scale),
      height: Math.round(imgH * scale),
    };
  }, [skImage, screenWidth]);

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
        setRenderTick((t) => t + 1);
        return;
      }
      const found = ASTRO_PRESETS.find((p) => p.id === presetId);
      if (found) {
        setActivePresetId(found.id);
        setParams({ ...found.params });
        setRenderTick((t) => t + 1);
      }
    },
    [skImage]
  );

  const adjustParam = (key: keyof AstroParams, delta: number, min: number, max: number) => {
    setActivePresetId('custom');
    setParams((prev) => ({
      ...prev,
      [key]: Math.min(max, Math.max(min, Number((prev[key] + delta).toFixed(2)))),
    }));
    setRenderTick((t) => t + 1);
  };

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

  const activeParams = showOriginal ? ASTRO_PRESETS[4].params : params;

  const uniforms = {
    resolution: [canvasDimensions.width, canvasDimensions.height],
    stretch: activeParams.stretch,
    blackPoint: activeParams.blackPoint,
    sharpen: activeParams.sharpen,
    denoise: activeParams.denoise,
    vibrance: activeParams.vibrance,
    starControl: activeParams.starControl,
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>AstroEnhancer</Text>
            <Text style={styles.subtitle}>Natural Deep-Sky, Lunar & Planetary Processor</Text>
          </View>
          <Pressable style={styles.primaryBtn} onPress={pickImage}>
            <Text style={styles.primaryBtnText}>{imageUri ? 'Change Photo' : 'Open Photo'}</Text>
          </Pressable>
        </View>

        {/* Preview Viewport */}
        <View style={[styles.canvasContainer, { height: canvasDimensions.height + 16 }]}>
          {skImage && runtimeEffect ? (
            <Pressable
              onPressIn={() => setShowOriginal(true)}
              onPressOut={() => setShowOriginal(false)}
              style={{ width: canvasDimensions.width, height: canvasDimensions.height }}
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
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {showOriginal ? 'RAW ORIGINAL' : 'ENHANCED (HOLD TO COMPARE)'}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable style={styles.emptyState} onPress={pickImage}>
              <Text style={styles.emptyTitle}>Tap to Load Astrophoto</Text>
              <Text style={styles.emptyDesc}>
                Automatically balances Nebulas, Galaxies, Moon, Sun & Planets
              </Text>
            </Pressable>
          )}
        </View>

        {/* Target Presets */}
        {skImage && (
          <>
            <Text style={styles.sectionTitle}>Enhancement Profiles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {ASTRO_PRESETS.map((preset) => {
                const isSelected = activePresetId === preset.id;
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

            {/* Manual Fine-Tuning */}
            <Text style={styles.sectionTitle}>Fine-Tune Pipeline</Text>
            <View style={styles.controlsCard}>
              <ControlRow
                label="Detail Stretch (Faint Gas & Dust)"
                value={params.stretch}
                onDec={() => adjustParam('stretch', -0.05, 0, 1)}
                onInc={() => adjustParam('stretch', 0.05, 0, 1)}
              />
              <ControlRow
                label="Sky Background Floor"
                value={params.blackPoint}
                onDec={() => adjustParam('blackPoint', -0.02, 0, 0.4)}
                onInc={() => adjustParam('blackPoint', 0.02, 0, 0.4)}
              />
              <ControlRow
                label="Star Control & White Cores"
                value={params.starControl}
                onDec={() => adjustParam('starControl', -0.1, 0, 1)}
                onInc={() => adjustParam('starControl', 0.1, 0, 1)}
              />
              <ControlRow
                label="Structure & Crater Sharpen"
                value={params.sharpen}
                onDec={() => adjustParam('sharpen', -0.1, 0, 1.5)}
                onInc={() => adjustParam('sharpen', 0.1, 0, 1.5)}
              />
              <ControlRow
                label="Natural Midtone Color"
                value={params.vibrance}
                onDec={() => adjustParam('vibrance', -0.1, 0, 1.5)}
                onInc={() => adjustParam('vibrance', 0.1, 0, 1.5)}
              />
              <ControlRow
                label="Background Denoise"
                value={params.denoise}
                onDec={() => adjustParam('denoise', -0.1, 0, 1)}
                onInc={() => adjustParam('denoise', 0.1, 0, 1)}
              />
            </View>

            {/* Export Button */}
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ControlRow({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.controlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepBtn} onPress={onDec}>
          <Text style={styles.stepBtnText}>-</Text>
        </Pressable>
        <Text style={styles.stepVal}>{Math.round(value * 100)}%</Text>
        <Pressable style={styles.stepBtn} onPress={onInc}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070A12',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 14,
  },
  canvasContainer: {
    backgroundColor: '#0D1322',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  emptyState: {
    padding: 32,
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
  },
  badge: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(7, 10, 18, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  presetRow: {
    marginBottom: 20,
  },
  presetCard: {
    width: 165,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 12,
    marginRight: 10,
  },
  presetCardActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#132238',
  },
  presetName: {
    color: '#F1F5F9',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  presetNameActive: {
    color: '#38BDF8',
  },
  presetDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  controlsCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
    marginBottom: 20,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  controlLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    backgroundColor: '#1E293B',
    width: 30,
    height: 30,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  stepVal: {
    color: '#38BDF8',
    width: 48,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 13,
  },
  exportBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
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
